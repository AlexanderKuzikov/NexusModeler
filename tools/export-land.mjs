/* Выгрузка набора пропсов в формат Echoes of Burbenog.
 *
 * Инструмент перенесён из NexusDefense КОПИЕЙ (tools/export-echoes-enemies.mjs)
 * и правится только здесь. Обратной синхронизации нет и не будет: две копии
 * одного экспортёра разъедутся, а пропсам свой инструмент нужен. Цена
 * названа в docs/DECISIONS.md сразу, а не обнаружена позже.
 *
 * Что перенесено и не менялось: writer glTF 2.0, разбор GLB на проверку,
 * сверка bytes и contentHash, требование детерминированной пересборки.
 *
 * Что изменено против исходника:
 *   - модель не «лепится под заданный бокс», а приходит из slots.js свёрстанной
 *     и уже посаженной: экспортёр только пишет;
 *   - узел акцента и эмиссия убраны — у пропсов их нет, поле в игре необязательное;
 *   - бюджеты не общие на существо, а по позиции слота плюс общий на набор;
 *   - в манифест добавлен блок `land`, обязательный для land.* и запрещённый
 *     у всего прочего.
 *
 * Запуск: node tools/export-land.mjs [--write | --check | --count]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLOTS } from '../slots.js';
import { SETS } from '../sets.js';
import { buildSlot } from '../build.js';

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(PROJECT_ROOT, 'export', 'land');

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_SHORT = 5123;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const MODE_TRIANGLES = 4;
const PRECISION = 1e5;

// Бюджеты из docs/CONTRACT.md. Держатся числами, а не ссылкой на документ:
// проверка обязана работать без чтения markdown.
const PER_SLOT_TRIANGLES = {
  tree: 600, bush: 180, rock: 350, debris: 220, ruin: 400, bone: 200,
};
const SET_BUDGET = { triangles: 20000, bytes: 8 * 1024 * 1024, models: 40 };
const MODEL_BUDGET = { bytes: 512 * 1024, nodes: 2, meshes: 1 };

const round = (value) => {
  const rounded = Math.round(value * PRECISION) / PRECISION;
  return rounded === 0 ? 0 : rounded;
};

const fail = (message) => {
  throw new Error(`contract violation: ${message}`);
};

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/* Наборы, которые выгружаются этим инструментом. Имена — часть контракта:
   запись land.<сет>.<NN> и файл land-<сет>-NN.glb обязаны совпадать. */
const BUILD_SETS = ['forest'];

// ---------- запись GLB ----------

const buildGlb = (model) => {
  const binParts = [];
  const bufferViews = [];
  const accessors = [];
  let binLength = 0;

  const appendView = (data, target) => {
    const padding = (4 - (binLength % 4)) % 4;
    if (padding > 0) {
      binParts.push(Buffer.alloc(padding));
      binLength += padding;
    }
    const byteOffset = binLength;
    binParts.push(data);
    binLength += data.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: data.length,
      ...(target === undefined ? {} : { target }),
    });
    return bufferViews.length - 1;
  };

  const vectorBounds = (values, components) => {
    const min = new Array(components).fill(Infinity);
    const max = new Array(components).fill(-Infinity);
    values.forEach((value, index) => {
      const axis = index % components;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    });
    return { min: min.map(round), max: max.map(round) };
  };

  const floatAccessor = (values, type) => {
    const components = { VEC3: 3, VEC4: 4 }[type];
    if (components === undefined || values.length === 0 || values.length % components !== 0) {
      fail(`модель ${model.id}: буфер не список ${type}`);
    }
    return (
      accessors.push({
        bufferView: appendView(Buffer.from(new Float32Array(values).buffer), TARGET_ARRAY_BUFFER),
        byteOffset: 0,
        componentType: COMPONENT_FLOAT,
        count: values.length / components,
        type,
        ...vectorBounds(values, components),
      }) - 1
    );
  };

  // Вершины округляются до миллионных ДО записи: иначе две пересборки одной
  // и той же формы дали бы разные байты, а contentHash в манифесте тогда
  // ничего не значил бы.
  const quantize = (values) => values.map((value) => round(value));

  const positions = quantize(model.p);
  const normals = quantize(model.n);
  const colors = quantize(model.c);

  const attributes = {
    POSITION: floatAccessor(positions, 'VEC3'),
    NORMAL: floatAccessor(normals, 'VEC3'),
    COLOR_0: floatAccessor(colors, 'VEC4'),
  };

  const indices = model.i;
  if (indices.length === 0 || indices.length % 3 !== 0) {
    fail(`модель ${model.id}: индексный буфер не целое число треугольников`);
  }
  const vertexCount = positions.length / 3;
  let min = Infinity, max = -Infinity;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      fail(`модель ${model.id}: ссылка на вершину ${index} вне ${vertexCount}`);
    }
    if (index < min) min = index;
    if (index > max) max = index;
  }
  if (vertexCount > 65536) fail(`модель ${model.id}: за пределами UNSIGNED_SHORT`);
  const indicesAccessor = (
    accessors.push({
      bufferView: appendView(Buffer.from(new Uint16Array(indices).buffer), TARGET_ELEMENT_ARRAY_BUFFER),
      byteOffset: 0,
      componentType: COMPONENT_UNSIGNED_SHORT,
      count: indices.length,
      type: 'SCALAR',
      min: [min],
      max: [max],
    }) - 1
  );

  const triangles = indices.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'nexus-modeler/export-land' },
    scene: 0,
    // Один корень: пропс — это один меш, и клиент ставит его на клетку
    // одним объектом. Дерево с иерархией здесь означало бы два вызова
    // отрисовки на пропс вместо одного.
    scenes: [{ name: model.id, nodes: [0] }],
    nodes: [{ name: model.id, mesh: 0 }],
    meshes: [{
      name: `${model.id}-mesh`,
      primitives: [{ attributes, indices: indicesAccessor, mode: MODE_TRIANGLES }],
    }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonChunk = Buffer.concat([
    jsonBytes,
    Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20),
  ]);
  const binBytes = Buffer.concat(binParts);
  const binChunk = Buffer.concat([binBytes, Buffer.alloc((4 - (binBytes.length % 4)) % 4)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const glb = Buffer.alloc(total);
  glb.writeUInt32LE(GLB_MAGIC, 0);
  glb.writeUInt32LE(GLB_VERSION, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.writeUInt32LE(CHUNK_JSON, 16);
  jsonChunk.copy(glb, 20);
  const binHeader = 20 + jsonChunk.length;
  glb.writeUInt32LE(binChunk.length, binHeader);
  glb.writeUInt32LE(CHUNK_BIN, binHeader + 4);
  binChunk.copy(glb, binHeader + 8);
  return { bytes: glb, triangles };
};

// ---------- проверка того, что записано ----------

const readGltf = (bytes, label) => {
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== GLB_MAGIC) fail(`${label}: плохая магия GLB`);
  if (bytes.readUInt32LE(4) !== GLB_VERSION) fail(`${label}: неподдерживаемая версия GLB`);
  if (bytes.readUInt32LE(8) !== bytes.length) fail(`${label}: длина в шапке не совпадает с файлом`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== CHUNK_JSON) fail(`${label}: первый чанк не JSON`);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  // Начало данных BIN-чанка берётся из самого заголовка файла, а не
  // пересчитывается через JSON.stringify: пересчёт опирался бы на то, что
  // сериализация вернёт те же байты, и разъехался бы при первом же
  // изменении формата записи.
  const binDataStart = 20 + jsonLength + 8;
  return { json, binDataStart };
};

// Читает геометрию обратно из файла: замеры берутся из того, что записано,
// а не из того, что было во время сборки. Иначе файл может разойтись с
// манифестом, и это обнаружится только в игре.
const verifyGlb = (bytes, entry) => {
  const label = entry.file;
  if (bytes.length !== entry.bytes) fail(`${label}: размер разошёлся с манифестом`);
  if (sha256(bytes) !== entry.contentHash) fail(`${label}: хеш разошёлся с манифестом`);
  const { json, binDataStart } = readGltf(bytes, label);

  if (json.asset?.version !== '2.0') fail(`${label}: asset.version должен быть 2.0`);
  if (json.materials !== undefined) fail(`${label}: материалы не допускаются`);
  if (json.textures !== undefined || json.images !== undefined) fail(`${label}: текстуры не допускаются`);
  if (json.skins !== undefined) fail(`${label}: скелет не допускается, ветер делает клиент`);
  if (json.animations !== undefined) fail(`${label}: клипы не допускаются без скелета`);
  if (json.extensions !== undefined || json.extensionsUsed !== undefined) {
    fail(`${label}: расширения не допускаются, файл обязан грузиться обычным GLTFLoader`);
  }

  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  if (nodes.length > MODEL_BUDGET.nodes) {
    fail(`${label}: ${nodes.length} узлов, бюджет ${MODEL_BUDGET.nodes}`);
  }
  if (meshes.length !== MODEL_BUDGET.meshes) {
    fail(`${label}: ${meshes.length} мешей, положен ровно ${MODEL_BUDGET.meshes}`);
  }

  let triangles = 0;
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives) {
      const attributes = primitive.attributes ?? {};
      if (attributes.COLOR_0 === undefined) {
        fail(`${label}: у примитива нет COLOR_0, цвет живёт на вершине`);
      }
      if (attributes.POSITION === undefined || attributes.NORMAL === undefined) {
        fail(`${label}: примитиву нужны POSITION и NORMAL`);
      }
      const extra = Object.keys(attributes).filter((key) => !['POSITION', 'NORMAL', 'COLOR_0'].includes(key));
      if (extra.length) fail(`${label}: нестандартные атрибуты ${extra.join(', ')}`);
      // Число вершин у всех атрибутов обязано совпадать: рендерер читает
      // буфер по POSITION, и более длинный COLOR_0 тихо отдаст цвет другой
      // вершины — крона получит цвет ствола, и это увидит только игрок.
      const counts = Object.entries(attributes).map(([key, index]) => [key, json.accessors[index].count]);
      const countsSet = new Set(counts.map(([, count]) => count));
      if (countsSet.size !== 1) {
        fail(`${label}: атрибуты разной длины: ${counts.map(([k, c]) => `${k}=${c}`).join(', ')}`);
      }
      if (primitive.material !== undefined) fail(`${label}: примитив не должен ссылаться на материал`);
      if ((primitive.mode ?? MODE_TRIANGLES) !== MODE_TRIANGLES) fail(`${label}: режим должен быть TRIANGLES`);
      if (primitive.targets !== undefined) fail(`${label}: морфинг не допускается`);
      const indices = json.accessors[primitive.indices];
      if (indices === undefined) fail(`${label}: у примитива нет индексного аксессора`);
      triangles += indices.count / 3;
    }
  }
  if (triangles !== entry.triangles) {
    fail(`${label}: ${triangles} треугольников в файле, манифест говорит ${entry.triangles}`);
  }
  const budget = PER_SLOT_TRIANGLES[entry.land.kind];
  if (triangles > budget) fail(`${label}: ${triangles} треугольников, по позиции положено ${budget}`);
  if (bytes.length > MODEL_BUDGET.bytes) {
    fail(`${label}: ${bytes.length} байт, бюджет ${MODEL_BUDGET.bytes}`);
  }

  // Замер по вершинам записанного файла: радиус считается на посаженной
  // модели, и посадку клиент не делает.
  const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const view = json.bufferViews[position.bufferView];
  const start = binDataStart + (view.byteOffset ?? 0) + (position.byteOffset ?? 0);
  const floats = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + position.count * 12),
  );
  if (floats.length !== position.count * 3) {
    fail(`${label}: не прочитан POSITION (${floats.length} из ${position.count * 3})`);
  }
  let minY = Infinity, maxY = -Infinity, radius = 0;
  for (let k = 0; k < floats.length; k += 3) {
    if (floats[k + 1] < minY) minY = floats[k + 1];
    if (floats[k + 1] > maxY) maxY = floats[k + 1];
    const r = Math.hypot(floats[k], floats[k + 2]);
    if (r > radius) radius = r;
  }
  const height = round(maxY);
  const measured = round(radius);
  if (Math.abs(minY) > 1e-3) {
    fail(`${label}: основание на ${round(minY)}, а не в нуле — модель висит или уходит вниз`);
  }
  if (Math.abs(height - entry.height) > 1e-3) {
    fail(`${label}: высота в файле ${height}, манифест говорит ${entry.height}`);
  }
  if (Math.abs(measured - entry.radius) > 1e-3) {
    fail(`${label}: радиус в файле ${measured}, манифест говорит ${entry.radius}`);
  }

  const roots = (json.scenes ?? [])[0]?.nodes ?? [];
  if (!roots.length) fail(`${label}: у сцены нет корневых узлов`);
  const reachable = new Set();
  const walk = (index) => {
    if (reachable.has(index)) return;
    reachable.add(index);
    for (const child of nodes[index]?.children ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  for (let index = 0; index < nodes.length; index += 1) {
    if (!reachable.has(index)) fail(`${label}: узел ${nodes[index].name} не достижим из сцены`);
  }
  return { triangles, height, radius };
};

// ---------- сборка ----------

const idOf = (setId, slot) => `land.${setId}.${String(slot.n).padStart(2, '0')}`;
const fileOf = (setId, slot) => `land-${setId}-${String(slot.n).padStart(2, '0')}.glb`;

const buildOne = (setId, set, slot) => {
  const model = buildSlot(slot.n, set);
  const id = idOf(setId, slot);
  const { bytes, triangles } = buildGlb({ ...model, id });

  // Вторая сборка того же описания обязана дать те же байты: иначе хеш в
  // манифесте ничего не значит, а пересборка выглядит как правка модели.
  const again = buildGlb({ ...buildSlot(slot.n, set), id });
  if (!again.bytes.equals(bytes)) fail(`${id}: сборка не детерминирована, два прогона разошлись`);

  const entry = {
    id,
    file: fileOf(setId, slot),
    bytes: bytes.length,
    contentHash: sha256(bytes),
    triangles,
    land: {
      slot: slot.n,
      kind: slot.kind,
      footprint: slot.footprint,
      solid: slot.solid,
    },
    height: round(model.height),
    radius: round(model.radius),
  };
  verifyGlb(bytes, entry);
  return { entry, bytes };
};

const build = () => {
  const results = [];
  for (const setId of BUILD_SETS) {
    const set = SETS[setId];
    if (!set) fail(`набор ${setId} не объявлен в sets.js`);
    for (const slot of SLOTS) {
      if (!set.forms?.[slot.n]) {
        fail(`набор ${setId}: слот ${slot.n} не заполнен — выгрузка не может быть полной`);
      }
      results.push({ setId, slot, ...buildOne(setId, set, slot) });
    }
  }
  const entries = results.map((result) => result.entry);

  if (entries.length !== SET_BUDGET.models) {
    fail(`в выгрузке ${entries.length} моделей, набор обязан дать ${SET_BUDGET.models}`);
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    fail('выгрузка повторяет id');
  }
  const triangles = entries.reduce((sum, entry) => sum + entry.triangles, 0);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (triangles > SET_BUDGET.triangles) {
    fail(`в выгрузке ${triangles} треугольников, бюджет набора ${SET_BUDGET.triangles}`);
  }
  if (totalBytes > SET_BUDGET.bytes) fail(`в выгрузке ${totalBytes} байт`);
  return { results, entries, triangles, totalBytes };
};

// Граница производителей: land обязателен у land.* и запрещён у всего
// прочего. Манифест выгрузки пропсов поэтому может содержать только land.*,
// и проверка это стережёт.
const checkManifestShape = (manifest) => {
  for (const entry of manifest.models) {
    const isLand = entry.id.startsWith('land.');
    if (isLand !== (entry.land !== undefined)) {
      fail(`${entry.id}: блок land ${isLand ? 'обязателен' : 'запрещён'}`);
    }
    if (!isLand) continue;
    if (!Number.isInteger(entry.land.slot) || entry.land.slot < 1 || entry.land.slot > 40) {
      fail(`${entry.id}: слот ${entry.land.slot} вне 1…40`);
    }
    if (!PER_SLOT_TRIANGLES[entry.land.kind]) fail(`${entry.id}: неизвестный kind ${entry.land.kind}`);
    if (entry.land.footprint !== 1 && entry.land.footprint !== 2) {
      fail(`${entry.id}: footprint ${entry.land.footprint}`);
    }
    if (entry.emissiveNode !== undefined) fail(`${entry.id}: у пропса нет узла акцента`);
    const slot = SLOTS.find((s) => s.n === entry.land.slot);
    if (!slot) fail(`${entry.id}: слота ${entry.land.slot} нет в реестре`);
    if (slot.kind !== entry.land.kind) fail(`${entry.id}: kind разошёлся с реестром`);
    if (slot.footprint !== entry.land.footprint) fail(`${entry.id}: footprint разошёлся с реестром`);
    if (slot.solid !== entry.land.solid) fail(`${entry.id}: solid разошёлся с реестром`);
  }
};

const check = () => {
  const manifestPath = join(OUT_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`нет ${manifestPath}: сначала запусти без --check`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1) fail('версия манифеста должна быть 1');
  checkManifestShape(manifest);

  const seen = new Set();
  for (const entry of manifest.models) {
    const bytes = readFileSync(join(OUT_DIR, entry.file));
    const read = verifyGlb(bytes, entry);
    seen.add(entry.land.slot);
    console.log(
      `${entry.id.padEnd(16)} ${String(entry.bytes).padStart(6)} б  ${String(read.triangles).padStart(4)} тр  ` +
        `h ${round(read.height)}  r ${round(read.radius)}  ${entry.land.kind}/${entry.land.footprint}к`,
    );
  }
  for (let n = 1; n <= 40; n += 1) {
    if (!seen.has(n)) fail(`в манифесте нет слота ${n} — набор неполон`);
  }
  const total = manifest.models.reduce((sum, entry) => sum + entry.triangles, 0);
  const totalBytes = manifest.models.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`набор: ${manifest.models.length} моделей, ${total} треугольников, ${totalBytes} байт · бюджет ${SET_BUDGET.triangles}`);
  console.log('assets: ok (--check)');
};

const main = () => {
  const mode = process.argv[2] ?? '--write';
  if (!['--write', '--check', '--count'].includes(mode)) fail(`неизвестный режим ${mode}`);
  if (mode === '--check') {
    check();
    return;
  }
  if (mode === '--count') {
    // Счётчики всех сорока сразу и ничего на диск: подгонка пропорций идёт
    // по этой таблице, а падать на первом слоте нельзя — иначе не видно,
    // где ещё не сошлось.
    for (const setId of BUILD_SETS) {
      const set = SETS[setId];
      for (const slot of SLOTS) {
        const model = buildSlot(slot.n, set);
        const budget = PER_SLOT_TRIANGLES[slot.kind];
        const fit = model.fitError ? ' ПРОПОРЦИИ' : '';
        console.log(
          `${setId} ${String(slot.n).padStart(2)} ${slot.name.padEnd(24)} ` +
            `${String(model.triangles).padStart(4)}/${String(budget).padStart(3)} тр  ` +
            `h ${String(round(model.height)).padStart(5)} [${slot.h[0]}…${slot.h[1]}]  ` +
            `r ${String(round(model.radius)).padStart(5)} [${slot.r[0]}…${slot.r[1]}]  ` +
            `scale ${round(model.scale ?? 1)}${fit}`,
        );
      }
    }
    return;
  }
  const { results, entries, triangles, totalBytes } = build();
  mkdirSync(OUT_DIR, { recursive: true });
  for (const result of results) {
    writeFileSync(join(OUT_DIR, result.entry.file), result.bytes);
  }
  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify({ version: 1, models: entries }, null, 2)}\n`,
  );
  console.log(`записано ${entries.length} моделей, ${triangles} треугольников, ${totalBytes} байт`);
  console.log('assets: ok (--write)');
};

try {
  main();
} catch (error) {
  if (process.env.LAND_TRACE) {
    console.error(error instanceof Error ? error.stack : String(error));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}