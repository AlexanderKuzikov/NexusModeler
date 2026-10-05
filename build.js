/* Сборка модели слота: форма набора → геометрия.
 *
 * Здесь три вещи, которые обязаны быть в одном месте: применение палитры,
 * посадка основания в ноль и замер после посадки. Замер до посадки даёт
 * число меньше настоящего — центрировать надо по уже сдвинутой модели.
 */

import { SLOTS, FORMS } from './slots.js';
import { xform } from './slots.js';

// sRGB → linear. Цвет живёт в COLOR_0, а glTF COLOR_0 линейный: без
// перевода модель уехала бы в темноту в 2.2 раза.
const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

export const linearColor = (hex) => [
  srgbToLinear(((hex >> 16) & 255) / 255),
  srgbToLinear(((hex >> 8) & 255) / 255),
  srgbToLinear((hex & 255) / 255),
];

// Палитра набора обязана покрыть все цвета, которые просит форма: пропущенный
// ключ дал бы NaN в COLOR_0, и модель уехала бы в неизвестный цвет молча.
export function buildPalette(name, palette) {
  if (!palette) throw new Error(`набор ${name}: нет палитры`);
  return palette;
}

/* Собирает модель слота в одну геометрию с цветом на вершину.
   Возвращает сырые массивы p/n/c/i — их одинаково читают витрина и сборщик
   GLB, поэтому второго пути у формы нет. */
export function buildSlot(slotNumber, set, { fit = true } = {}) {
  const slot = SLOTS.find((entry) => entry.n === slotNumber);
  if (!slot) throw new Error(`нет слота ${slotNumber}`);
  const formName = set.forms?.[slotNumber]?.form ?? slot.form;
  const build = FORMS[formName];
  if (!build) throw new Error(`слот ${slotNumber}: нет формы ${formName}`);

  const palette = buildPalette(set.id, set.palette);
  // Форме отдаются числа, а не полосы: полоса — это обещание карте, а форма
  // работает с одним размером. Набор может подменить число, но не полосу.
  const params = {
    ...slot,
    h: set.forms?.[slotNumber]?.h ?? mid(slot.h),
    r: set.forms?.[slotNumber]?.r ?? mid(slot.r),
  };

  const parts = build(params, palette);
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error(`слот ${slotNumber} (${formName}): форма вернула пустое`);
  }

  const p = [], n = [], c = [], i = [];
  let colorKey = null;
  let colorValue = null;

  for (const entry of parts) {
    // Пропущенный ключ палитры обязан падать здесь, а не давать NaN: NaN в
    // вершине видна как «модель исчезла», и найти её нечем.
    if (typeof entry.color !== 'number' || !Number.isFinite(entry.color)) {
      throw new Error(`слот ${slotNumber} (${formName}): цвет ${entry.color} не из палитры`);
    }
    if (entry.color !== colorKey) {
      colorKey = entry.color;
      colorValue = linearColor(entry.color);
    }
    const local = xform(entry.geo.p, entry.geo.n, entry);
    const base = p.length / 3;
    // Шаг на три, а не на один: шаг на один писал бы четыре компоненты
    // цвета на каждый флоат позиции, и COLOR_0 выходил бы втрое длиннее
    // POSITION. Рендерер и GLTFLoader читают буфер по числу вершин из
    // POSITION, поэтому крону красил бы цвет ствола — тихо и без ошибок.
    for (let k = 0; k < local.p.length; k += 3) {
      p.push(local.p[k], local.p[k + 1], local.p[k + 2]);
      n.push(local.n[k], local.n[k + 1], local.n[k + 2]);
      c.push(colorValue[0], colorValue[1], colorValue[2], 1);
    }
    for (let k = 0; k < entry.geo.i.length; k += 1) i.push(entry.geo.i[k] + base);
  }

  if (i.length === 0) throw new Error(`слот ${slotNumber}: форма без треугольников`);
  // Длины буферов обязаны быть согласованы, иначе расхождение уедет в файл
  // и обнаружится только в игре, где цвет будет взят не из той вершины.
  const verts = p.length / 3;
  if (n.length !== p.length) {
    throw new Error(`слот ${slotNumber}: NORMAL (${n.length}) не совпадает с POSITION (${p.length})`);
  }
  if (c.length !== verts * 4) {
    throw new Error(`слот ${slotNumber}: COLOR_0 (${c.length}) не совпадает с ${verts} вершинами`);
  }

  const result = { p, n, c, i, triangles: i.length / 3, slot, form: formName };

  // Порядок именно такой: посадка → замер → масштаб → снова посадка и замер.
  // Радиус, посчитанный до посадки, меньше настоящего, потому что посадка
  // сдвигает центр в ноль: измерять до неё — значит мерить другую модель.
  seatToGround(result);
  if (fit) fitToSlot(result, slot);
  seatToGround(result);
  measure(result);
  return result;
}

/* Посадка по слоту: равномерный масштаб, вписанный в полосу размеров.

   Масштаб всегда равномерный, потому что вытянутая по одной оси модель
   растягивает силуэт, а силуэт — это всё, что читается с расстояния.

   Допустимые масштабы образуют интервал: снизу его поднимает требование
   попасть в нижнюю границу полосы, сверху опускает верхняя. Если интервал
   пуст, пропорции формы не совпадают с полосой слота — и это должен сказать
   check-slots, а не молча подогнать по одной оси: растянутое по высоте
   бревно не похоже на бревно ровно настолько, насколько масштаб «помог». */
function fitToSlot(model, slot) {
  const raw = measure({ p: model.p });
  if (raw.height <= 1e-9) return;
  const lo = Math.max(slot.h[0] / raw.height, raw.radius > 1e-9 ? slot.r[0] / raw.radius : 0);
  const hi = Math.min(slot.h[1] / raw.height, raw.radius > 1e-9 ? slot.r[1] / raw.radius : Infinity);
  if (!(lo <= hi)) {
    model.fitError = `полосы не сходятся: нужны пропорции r/h от `
      + `${round(slot.r[0] / slot.h[1])} до ${round(slot.r[1] / slot.h[0])}, форма даёт ${round(raw.radius / raw.height)}`;
    model.scale = lo;
  } else {
    // Середина интервала: модель встаёт на середину полосы обеими
    // мерками, и ни одна из них не работает впритык.
    model.scale = (lo + hi) / 2;
  }
  for (let k = 0; k < model.p.length; k += 1) model.p[k] *= model.scale;
}

const round = (value) => Math.round(value * 1000) / 1000;
const mid = (band) => (band[0] + band[1]) / 2;

/* Посадка: минимум по Y в ноль, центр по X и Z в ноль. Основание обязано
   садиться в землю — иначе пропс висит в воздухе или уходит под карту. */
function seatToGround(model) {
  let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < model.p.length; k += 3) {
    if (model.p[k + 1] < minY) minY = model.p[k + 1];
    if (model.p[k] < minX) minX = model.p[k];
    if (model.p[k] > maxX) maxX = model.p[k];
    if (model.p[k + 2] < minZ) minZ = model.p[k + 2];
    if (model.p[k + 2] > maxZ) maxZ = model.p[k + 2];
  }
  const dx = -(minX + maxX) / 2;
  const dz = -(minZ + maxZ) / 2;
  const dy = -minY;
  for (let k = 0; k < model.p.length; k += 3) {
    model.p[k] += dx;
    model.p[k + 1] += dy;
    model.p[k + 2] += dz;
  }
}

/* Замер по вершинам, а не по углам bbox: клиент меряет именно так, а угол
   пустого бокса у диска завышает радиус почти вдвое. */
function measure(model) {
  let maxY = -Infinity, radius = 0;
  for (let k = 0; k < model.p.length; k += 3) {
    if (model.p[k + 1] > maxY) maxY = model.p[k + 1];
    const r = Math.hypot(model.p[k], model.p[k + 2]);
    if (r > radius) radius = r;
  }
  model.height = maxY;
  model.radius = radius;
  return model;
}

