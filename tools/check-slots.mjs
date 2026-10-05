/* Проверка слотов и наборов без браузера.
 *
 * Запуск:  node tools/check-slots.mjs
 *
 * Проверка обязана ПАДАТЬ на каждом нарушении контракта, а не печатать его:
 * тихо напечатанная ошибка в витрине читается как «вроде работает», и
 * пропущенный номер набора уезжает в игру дырой на карте.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLOTS, FORMS, TAU } from '../slots.js';
import { SETS } from '../sets.js';
import { buildSlot } from '../build.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const problems = [];
const fail = (message) => problems.push(message);

// Границы из контракта. Держатся здесь, а не берутся из документа: проверка
// обязана работать без чтения markdown, иначе она сломается вместе с ним.
const KINDS = new Set(['tree', 'bush', 'rock', 'debris', 'ruin', 'bone']);
const PASSTHROUGH = new Set(['bush', 'bone']);

// Бюджет треугольников по позиции. Общий бюджет набора — 20 000 на сорок
// моделей: бюджет сцены в игре 250 000, и рельеф не должен его съедать.
const PER_SLOT_TRIANGLES = {
  tree: 600, bush: 180, rock: 350, debris: 220, ruin: 400, bone: 200,
};
const SET_TRIANGLES = 20000;

// Размеры по kind из контракта: высота и радиус в единицах игры.
const SIZE_BANDS = {
  tree: [3.0, 7.0, 0.7, 1.6],
  bush: [0.5, 1.6, 0.6, 1.4],
  rock: [0.4, 2.4, 0.4, 1.6],
  debris: [0.25, 1.2, 0.5, 1.8],
  ruin: [1.2, 4.0, 0.6, 1.8],
  bone: [0.25, 0.8, 0.4, 1.3],
};

// ---------- реестр слотов ----------

const checkRegistry = () => {
  const seen = new Set();
  for (const slot of SLOTS) {
    if (!Number.isInteger(slot.n) || slot.n < 1 || slot.n > 40) {
      fail(`слот: номер ${slot.n} вне 1…40 — номер это контракт с игрой`);
    }
    if (seen.has(slot.n)) fail(`слот: номер ${slot.n} повторяется`);
    seen.add(slot.n);
    if (!KINDS.has(slot.kind)) fail(`слот ${slot.n}: kind "${slot.kind}" не из списка`);
    if (slot.footprint !== 1 && slot.footprint !== 2) {
      fail(`слот ${slot.n}: footprint ${slot.footprint}, допустимо 1 или 2`);
    }
    // Через bush и bone проходят, и они не затеняют обзор. solid: true у
    // них — это либо монстр в стене, либо непроходимая трава.
    if (slot.solid !== !PASSTHROUGH.has(slot.kind)) {
      fail(`слот ${slot.n}: solid ${slot.solid} не соответствует kind ${slot.kind}`);
    }
    const band = SIZE_BANDS[slot.kind];
    if (band) {
      if (slot.h[0] < band[0] || slot.h[1] > band[1]) {
        fail(`слот ${slot.n}: полоса высоты ${slot.h.join('…')} выходит за ${band[0]}…${band[1]} для ${slot.kind}`);
      }
      if (slot.r[0] < band[2] || slot.r[1] > band[3]) {
        fail(`слот ${slot.n}: полоса радиуса ${slot.r.join('…')} выходит за ${band[2]}…${band[3]} для ${slot.kind}`);
      }
    }
  }
  for (let n = 1; n <= 40; n += 1) {
    if (!seen.has(n)) fail(`реестр: нет слота ${n} — пропуск в реестре ломает нумерацию`);
  }
};

// ---------- наборы ----------

const checkSet = (id, set) => {
  const filled = set.forms ?? {};
  let total = 0;
  const rows = [];

  // Правило полноты: набор обязан перечислить все сорок номеров. Пропуск —
  // дыра на карте, поэтому он падает здесь, а не всплывает в игре.
  for (let n = 1; n <= 40; n += 1) {
    if (!filled[n]) fail(`набор ${id}: слот ${n} не заполнен — пропуск в наборе`);
  }
  for (const key of Object.keys(filled)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > 40) fail(`набор ${id}: номер слота ${key} вне 1…40`);
  }

  for (const slot of SLOTS) {
    if (!filled[slot.n]) continue;
    const formName = filled[slot.n].form;
    if (!formName) {
      fail(`набор ${id}, слот ${slot.n}: не указана форма`);
      continue;
    }
    if (!FORMS[formName]) {
      fail(`набор ${id}, слот ${slot.n}: нет формы ${formName} в словаре`);
      continue;
    }
    let model;
    try {
      model = buildSlot(slot.n, set);
    } catch (error) {
      fail(`набор ${id}, слот ${slot.n} (${formName}): ${error.message}`);
      continue;
    }
    total += model.triangles;

    // Пропорции формы против полосы слота: если интервал допустимых
    // масштабов пуст, подгонка впихнула бы модель в полосу искажением
    // силуэта, а силуэт — это всё, что читается с расстояния.
    if (model.fitError) {
      fail(`набор ${id}, слот ${slot.n} (${slot.name}): ${model.fitError}`);
    }

    const budget = PER_SLOT_TRIANGLES[slot.kind];
    if (model.triangles > budget) {
      fail(
        `набор ${id}, слот ${slot.n} (${slot.name}): ${model.triangles} треугольников, ` +
          `по позиции положено ${budget}. Треугольник не правит, это бюджет формы`,
      );
    }
    // Полоса размеров — это обещание карте, и она проверяется по обоим
    // числам. Высота вне полосы меняет читаемость соседей (дерево выше
    // заявленного глушит дорогу), радиус вылезает на соседние клетки.
    if (model.height < slot.h[0] - 1e-6 || model.height > slot.h[1] + 1e-6) {
      fail(
        `набор ${id}, слот ${slot.n} (${slot.name}): высота ${round(model.height)} вне ` +
          `полосы ${slot.h[0]}…${slot.h[1]}`,
      );
    }
    if (model.radius < slot.r[0] - 1e-6 || model.radius > slot.r[1] + 1e-6) {
      fail(
        `набор ${id}, слот ${slot.n} (${slot.name}): радиус ${round(model.radius)} вне ` +
          `полосы ${slot.r[0]}…${slot.r[1]}`,
      );
    }
    const band = SIZE_BANDS[slot.kind];
    if (band && (model.height < band[0] || model.height > band[1])) {
      fail(
        `набор ${id}, слот ${slot.n} (${slot.name}): высота ${round(model.height)} вне ` +
          `${band[0]}…${band[1]} для ${slot.kind} — полоса слота разошлась с контрактом`,
      );
    }
    // Основание обязано садиться в ноль: иначе модель висит или уходит вниз.
    let minY = Infinity;
    for (let k = 1; k < model.p.length; k += 3) if (model.p[k] < minY) minY = model.p[k];
    if (Math.abs(minY) > 1e-4) {
      fail(`набор ${id}, слот ${slot.n}: основание на ${round(minY)}, а не в нуле`);
    }
    if (model.p.some((value) => !Number.isFinite(value))) {
      fail(`набор ${id}, слот ${slot.n}: в вершинах есть NaN или бесконечность`);
    }
    // Буферы обязаны быть согласованы между собой. Рендерер и GLTFLoader
    // читают COLOR_0 по числу вершин из POSITION, и расхождение длин даёт
    // не ошибку, а чужой цвет на части модели — самый дорогой вид отказа,
    // потому что он виден только в игре.
    const verts = model.p.length / 3;
    if (model.n.length !== model.p.length) {
      fail(`набор ${id}, слот ${slot.n}: NORMAL (${model.n.length}) не совпадает с POSITION (${model.p.length})`);
    }
    if (model.c.length !== verts * 4) {
      fail(`набор ${id}, слот ${slot.n}: COLOR_0 (${model.c.length}) не совпадает с ${verts} вершинами`);
    }
    if (model.i.some((index) => !Number.isInteger(index) || index < 0 || index >= verts)) {
      fail(`набор ${id}, слот ${slot.n}: индекс ссылается на вершину вне ${verts}`);
    }
    // Нормаль обязана быть единичной: иначе свет считается по кривой, и грань
    // освещается не тем, чем задумано, а ошибку видно только на витрине.
    let badNormal = 0;
    for (let k = 0; k < model.n.length; k += 3) {
      const length = Math.hypot(model.n[k], model.n[k + 1], model.n[k + 2]);
      if (Math.abs(length - 1) > 0.02) badNormal += 1;
    }
    if (badNormal > 0) {
      fail(`набор ${id}, слот ${slot.n}: ${badNormal} нормалей не единичной длины`);
    }

    rows.push({ n: slot.n, name: slot.name, tris: model.triangles, h: model.height, r: model.radius, kind: slot.kind });
  }

  if (total > SET_TRIANGLES) {
    fail(`набор ${id}: ${total} треугольников на сорок моделей, общий бюджет ${SET_TRIANGLES}`);
  }
  return { rows, total };
};

const round = (value) => Math.round(value * 1000) / 1000;

// ---------- сверка с контрактом ----------
//
// Реестр живёт в коде, но источник истины — docs/CONTRACT.md. Если таблица
// разошлась с кодом, одна из двух сторон врёт, и это надо видеть.
//
// Расхождение здесь — ПАДЕНИЕ, а не предупреждение. Контракт объявлен
// единственным источником истины, и предупреждение делало его декорацией:
// следующее расхождение прошло бы молча, а молчаливое расхождение документа с
// кодом — это не «неаккуратно», это слот, который в игре поведёт себя не так,
// как обещает таблица. Спорные места решаются правкой документа или кода
// владельцем, а не тишиной.
//
// Таблица обязана читаться целиком: пропущенная строка при старом коде
// проверялась бы «успешно», просто потому что о ней никто не спросил.

const checkContractTable = () => {
  const text = readFileSync(join(root, 'docs', 'CONTRACT.md'), 'utf8');
  const rows = [...text.matchAll(/^\|\s*(\d+)\s*\|\s*`(\w+)`\s*\|\s*(\d)\s*\|\s*(да|нет)\s*\|/gm)];
  if (rows.length === 0) {
    fail('CONTRACT.md: таблица реестра не найдена или её формат разошёлся — сверять нечего');
    return;
  }
  const numbers = new Set(rows.map(([, n]) => Number(n)));
  if (rows.length !== 40 || numbers.size !== 40) {
    fail(
      `CONTRACT.md: в таблице реестра ${rows.length} строк и ${numbers.size} номеров, ` +
        `а реестр это 1…40. Сверка молча пропустила бы номера, которых в документе нет`,
    );
  }
  for (const [, n, kind, footprint, solid] of rows) {
    const slot = SLOTS.find((entry) => entry.n === Number(n));
    if (!slot) { fail(`CONTRACT.md, слот ${n}: есть в документе, но нет в реестре`); continue; }
    if (slot.kind !== kind) fail(`CONTRACT.md, слот ${n}: kind ${slot.kind} против ${kind} в документе`);
    if (slot.footprint !== Number(footprint)) {
      fail(`CONTRACT.md, слот ${n}: footprint ${slot.footprint} против ${footprint} в документе`);
    }
    if (slot.solid !== (solid === 'да')) fail(`CONTRACT.md, слот ${n}: solid ${slot.solid} против ${solid}`);
  }
};

// ---------- прогон ----------

checkRegistry();
checkContractTable();

console.log(`Слотов в реестре: ${SLOTS.length}`);
console.log(`Наборов: ${Object.keys(SETS).length}`);

for (const [id, set] of Object.entries(SETS)) {
  const { rows, total } = checkSet(id, set);
  console.log(`\nНабор «${set.name}» (${id}) — ${rows.length}/40 слотов, ${total} треугольников, бюджет ${SET_TRIANGLES}`);
  for (const row of rows) {
    const flag = row.tris > PER_SLOT_TRIANGLES[row.kind] ? ' !' : '';
    console.log(
      `  ${String(row.n).padStart(2)} ${row.name.padEnd(26)} ` +
        `${String(row.tris).padStart(4)} тр  ${round(row.h)}×${round(row.r)}${flag}`,
    );
  }
}

if (problems.length) {
  console.error('\nПРОБЛЕМЫ КОНТРАКТА:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nКонтракт слотов: OK');