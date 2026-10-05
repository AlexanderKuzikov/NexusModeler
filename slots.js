/* NexusModeler — ядро пропсов: примитивы, словарь форм, реестр слотов.
 *
 * Геометрия строится плоскими массивами {p, n, i}, а не объектами three.
 * Причина практическая: этот же файл читают и витрина (оборачивает массивы
 * в BufferGeometry), и сборщик GLB (пишет их в файл). Вторая реализация
 * формы означала бы, что предпросмотр в Burrow3D рано или поздно разойдётся
 * с игрой, а это ровно тот класс расхождения, из-за которого проекты разделены.
 *
 * Никакого three в этом файле: он должен грузиться и в браузере, и в node.
 */

export const TAU = Math.PI * 2;

// ---------- математика ----------

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 1e-9 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 1, 0];
};

// Детерминированный шум по индексу. Math.random дал бы другие байты при
// каждой пересборке, а contentHash в манифесте обязан быть воспроизводимым.
const noise = (i, seed = 0) => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------- геометрия ----------

// geo — геометрия в плоских массивах. p и n одной длины, i кратен 3.
const geo = () => ({ p: [], n: [], i: [] });

// Вырожденные треугольники не пишутся: они всё равно вошли бы в бюджет и
// давали нулевую площадь на экране.
const tri = (g, a, b, c, na, nb, nc) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  if (Math.hypot(gx, gy, gz) < 1e-8) return;
  // Намотка против средней нормали: выписывать её руками в сорока формах —
  // гарантированная ошибка в одном треугольнике, которая видна как чёрная
  // грань и стоит пересборки файла.
  const mx = (na[0] + nb[0] + nc[0]) / 3;
  const my = (na[1] + nb[1] + nc[1]) / 3;
  const mz = (na[2] + nb[2] + nc[2]) / 3;
  const flip = gx * mx + gy * my + gz * mz < 0;
  const base = g.p.length / 3;
  const order = flip ? [a, c, b] : [a, b, c];
  const normals = flip ? [na, nc, nb] : [na, nb, nc];
  order.forEach((v, k) => {
    g.p.push(v[0], v[1], v[2]);
    g.n.push(normals[k][0], normals[k][1], normals[k][2]);
  });
  g.i.push(base, base + 1, base + 2);
};

const quad = (g, a, b, c, d, na, nb, nc, nd) => {
  tri(g, a, b, c, na, nb, nc);
  tri(g, a, c, d, na, nc, nd);
};

// Часть: геометрия, цвет, локальный трансформ. Части собираются в один меш
// на модель — сорок пропсов на карте это сорок вызовов отрисовки, и каждый
// лишний узел платит из общего бюджета сцены.
const part = (g, color, { t = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) => ({
  geo: g, color, t, r, s,
});
const P = (g, color, place) => part(g, color, place);

// Трансформ части: поворот XYZ (как в three), затем масштаб, затем сдвиг.
const xform = (p, n, place) => {
  const [rx, ry, rz] = place.r;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const sc = typeof place.s === 'number' ? [place.s, place.s, place.s] : place.s;
  const rotate = (x, y, z) => {
    const ny = y * cx - z * sx, nz = y * sx + z * cx;
    const mx = x * cy + nz * sy, mz = -x * sy + nz * cy;
    return [mx * cz - ny * sz, mx * sz + ny * cz, mz];
  };
  const out = { p: [], n: [] };
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = rotate(p[i] * sc[0], p[i + 1] * sc[1], p[i + 2] * sc[2]);
    out.p.push(x + place.t[0], y + place.t[1], z + place.t[2]);
    // Нормаль делится на масштаб оси: иначе после неравномерного растяжения
    // грани освещаются не тем, чем задумано.
    const [nx, ny, nz] = rotate(n[i] / sc[0], n[i + 1] / sc[1], n[i + 2] / sc[2]);
    const length = Math.hypot(nx, ny, nz) || 1;
    out.n.push(nx / length, ny / length, nz / length);
  }
  return out;
};

// Нормали по граням: нужны после дёрганья вершин, иначе свет считается по
// прежней форме и камень выглядит как гладкий шар.
const recalc = (g) => {
  const n = new Array(g.p.length).fill(0);
  for (let t = 0; t < g.i.length; t += 3) {
    const a = g.i[t] * 3, b = g.i[t + 1] * 3, c = g.i[t + 2] * 3;
    const ux = g.p[b] - g.p[a], uy = g.p[b + 1] - g.p[a + 1], uz = g.p[b + 2] - g.p[a + 2];
    const vx = g.p[c] - g.p[a], vy = g.p[c + 1] - g.p[a + 1], vz = g.p[c + 2] - g.p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let k = 0; k < n.length; k += 3) {
    const length = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    g.n[k] = n[k] / length;
    g.n[k + 1] = n[k + 1] / length;
    g.n[k + 2] = n[k + 2] / length;
  }
};

// ---------- примитивы форм ----------

// Цилиндр, конус (rTop = 0) или усечённый конус. Крышка при нулевом радиусе
// вырождена в точку и не пишется: иначе появляются нулевые треугольники,
// которые всё равно считались бы бюджетом.
const cyl = (rTop, rBot, h, seg, { flat = false, capTop = true, capBot = true } = {}) => {
  const g = geo();
  const slope = (rBot - rTop) / h;
  const radial = (radius, angle, y) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  const sideNormal = (angle) => {
    const n = [Math.cos(angle), slope, Math.sin(angle)];
    const length = Math.hypot(n[0], n[1], n[2]);
    return [n[0] / length, n[1] / length, n[2] / length];
  };
  for (let i = 0; i < seg; i += 1) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    const b0 = radial(rBot, a0, 0), b1 = radial(rBot, a1, 0);
    const t0 = radial(rTop, a0, h), t1 = radial(rTop, a1, h);
    if (flat) {
      const n = sideNormal((a0 + a1) / 2);
      quad(g, b0, t0, t1, b1, n, n, n, n);
    } else {
      quad(g, b0, t0, t1, b1, sideNormal(a0), sideNormal(a0), sideNormal(a1), sideNormal(a1));
    }
  }
  const cap = (radius, y, normal) => {
    if (radius <= 1e-6) return;
    const centre = [0, y, 0];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      tri(g, centre, radial(radius, a0, y), radial(radius, a1, y), normal, normal, normal);
    }
  };
  if (capBot) cap(rBot, 0, [0, -1, 0]);
  if (capTop) cap(rTop, h, [0, 1, 0]);
  return g;
};

// Ящик с нижней гранью в нуле. Ориентируется углом, а не базисом: у ступеней
// и досок важна сама плоскость, а не поворот вокруг оси.
const boxGeo = (w, h, d) => {
  const g = geo();
  const x = w / 2, z = d / 2;
  const v = (a, b, c) => [a, b, c];
  quad(g, v(x, 0, -z), v(x, h, -z), v(x, h, z), v(x, 0, z), [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]);
  quad(g, v(-x, 0, z), v(-x, h, z), v(-x, h, -z), v(-x, 0, -z), [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0]);
  quad(g, v(-x, h, -z), v(-x, h, z), v(x, h, z), v(x, h, -z), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]);
  quad(g, v(-x, 0, z), v(-x, 0, -z), v(x, 0, -z), v(x, 0, z), [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0]);
  quad(g, v(-x, 0, z), v(x, 0, z), v(x, h, z), v(-x, h, z), [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]);
  quad(g, v(x, 0, -z), v(-x, 0, -z), v(-x, h, -z), v(x, h, -z), [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]);
  return g;
};

// Труба по ломаной: стволы с изгибом, ветви, корни, кости, жерди. Кадры
// переносятся параллельно, поэтому труба не скручивается на поворотах —
// скрутка видна как «винт» на гладком стволе.
const tube = (points, radii, seg = 5, { capStart = false, capEnd = true } = {}) => {
  const g = geo();
  const count = points.length;
  const tangents = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(count - 1, i + 1)];
    return unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  });
  let u = unit(cross(tangents[0], Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      const t = tangents[i];
      const d = u[0] * t[0] + u[1] * t[1] + u[2] * t[2];
      u = unit([u[0] - t[0] * d, u[1] - t[1] * d, u[2] - t[2] * d]);
    }
    const t = tangents[i];
    const v = unit(cross(t, u));
    const ring = [];
    for (let j = 0; j < seg; j += 1) {
      const a = (j / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const n = [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa];
      ring.push({
        p: [
          points[i][0] + n[0] * radii[i],
          points[i][1] + n[1] * radii[i],
          points[i][2] + n[2] * radii[i],
        ],
        n,
      });
    }
    rings.push(ring);
  }
  for (let i = 0; i < count - 1; i += 1) {
    for (let j = 0; j < seg; j += 1) {
      const k = (j + 1) % seg;
      quad(g,
        rings[i][j].p, rings[i][k].p, rings[i + 1][k].p, rings[i + 1][j].p,
        rings[i][j].n, rings[i][k].n, rings[i + 1][k].n, rings[i + 1][j].n);
    }
  }
  const cap = (i, normal) => {
    const centre = [points[i][0], points[i][1], points[i][2]];
    for (let j = 0; j < seg; j += 1) {
      tri(g, centre, rings[i][j].p, rings[i][(j + 1) % seg].p, normal, normal, normal);
    }
  };
  if (capStart) cap(0, unit(tangents[0].map((v) => -v)));
  const last = count - 1;
  if (capEnd && radii[last] > 1e-5) cap(last, tangents[last]);
  return g;
};

// Сфера или эллипсоид. Низкий seg здесь форма, а не экономия: гладкая
// оболочка даёт читаемый контур, крупные грани дают «сетку», которая на
// игровом масштабе выглядит как дыры в силуэте.
const orb = (r, widthSeg = 8, heightSeg = 5) => {
  const g = geo();
  const point = (phi, theta) => {
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.cos(phi);
    const z = Math.sin(phi) * Math.sin(theta);
    return [[x * r, y * r, z * r], [x, y, z]];
  };
  for (let i = 0; i < heightSeg; i += 1) {
    const phi0 = (i / heightSeg) * Math.PI, phi1 = ((i + 1) / heightSeg) * Math.PI;
    for (let j = 0; j < widthSeg; j += 1) {
      const theta0 = (j / widthSeg) * TAU, theta1 = ((j + 1) / widthSeg) * TAU;
      const [p00, n00] = point(phi0, theta0);
      const [p01, n01] = point(phi0, theta1);
      const [p10, n10] = point(phi1, theta0);
      const [p11, n11] = point(phi1, theta1);
      quad(g, p00, p10, p11, p01, n00, n10, n11, n01);
    }
  }
  return g;
};

const ICO_T = (1 + Math.sqrt(5)) / 2;
const icoVertex = (i) => {
  const raw = [
    [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0],
    [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T],
    [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1],
  ][i];
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  return [raw[0] / length, raw[1] / length, raw[2] / length];
};

const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const icosa = (r, detail = 0) => {
  let faces = ICO_FACES.map((face) => face.map((index) => icoVertex(index)));
  for (let level = 0; level < detail; level += 1) {
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2];
      const ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2];
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }
  const g = geo();
  for (const [a, b, c] of faces) {
    const scale = (v) => [v[0] * r, v[1] * r, v[2] * r];
    tri(g, scale(a), scale(b), scale(c), a, b, c);
  }
  return g;
};

// Гранёный ромб. Мелкие детали — глаз, зуб, камешек, шип — занимают единицы
// пикселей, и сфера там стоит вчетверо дороже при том же силуэте.
const octa = (r) => {
  const g = geo();
  const v = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
  const faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  for (const [a, b, c] of faces) {
    tri(g, v[a], v[b], v[c], unit(v[a]), unit(v[b]), unit(v[c]));
  }
  return g;
};

// ---------- словарь форм ----------
//
// Форма — не «модель», а способ лепить класс формы. Слот ссылается на форму
// и задаёт параметры, поэтому один словарь обслуживает и лес, и пустыню:
// на слоте 7 у леса сухостой, у гор встанет валун той же формы с другими
// числами. Сорок отдельных несвязанных моделей были бы не работой, а сорок
// работами.

/* Ствол с необязательным изгибом. Смещение идёт квадратом по высоте: при
   линейном смещении у корня изгиб резкий и ствол читается как клюшка. */
const trunkGeo = ({ height, radius, top = 0.5, bend = 0, dir = 0, seg = 6, steps = 4 }) => {
  const points = [], radii = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([Math.cos(dir) * bend * t * t, height * t, Math.sin(dir) * bend * t * t]);
    radii.push(radius * (1 - (1 - top) * t));
  }
  return tube(points, radii, seg, { capStart: false, capEnd: true });
};

/* Ветвь из точки: короткая труба с приподнятым концом. rise — угол
   подъёма; изгиб конца квадратом даёт поднятые лапы ели. */
const branchGeo = (from, length, radius, angle, rise, seg = 4) => {
  const points = [], radii = [];
  for (let i = 0; i <= 2; i += 1) {
    const t = i / 2;
    const reach = length * t;
    points.push([
      from[0] + Math.cos(angle) * reach,
      from[1] + Math.sin(rise) * reach + length * rise * 0.2 * t * t,
      from[2] + Math.sin(angle) * reach,
    ]);
    radii.push(radius * (1 - 0.7 * t));
  }
  return tube(points, radii, seg, { capStart: false, capEnd: true });
};

/* Ярус хвои: усечённый конус с плоским верхом. Ярусами, а не цельной
   пирамидой, потому что ступень кроны и есть силуэт хвойного. */
const tierGeo = (y, radius, height, seg = 8, topRatio = 0.2, color) =>
  P(cyl(radius * topRatio, radius, height, seg, { flat: true, capBot: false }), color, { t: [0, y, 0] });

/* Остов ветвей для куста и кроны: пучок расходящихся стволиков. Один шар
   читается как мяч, а пучок веток — как куст. */
const spray = (base, count, reach, lift, radius, color, seed, seg = 4) => {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU + noise(i, seed) * 0.9;
    const len = reach * (0.62 + noise(i, seed + 1) * 0.5);
    out.push(P(branchGeo([base[0], base[1], base[2]], len, radius, a, lift, seg), color));
  }
  return out;
};

/* Лист-лента: плоская двусторонняя полоса с заострением и изгибом. Двусторонняя
   обязательна: под односторонним материалом половина листьев исчезает при
   повороте камеры. */
const bladeGeo = (length, width, { curve = 0.5, lean = 0, taper = 0.1, steps = 3 } = {}) => {
  const g = geo();
  const rows = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const cx = lean * length * t * t;
    const cy = length * t;
    const cz = curve * length * t * t;
    const half = (width / 2) * (1 - (1 - taper) * t);
    rows.push({ c: [cx, cy, cz], half });
  }
  for (let i = 0; i < steps; i += 1) {
    const a = rows[i], b = rows[i + 1];
    // Нормаль ленты перпендикулярна её плоскости: она зависит от наклона
    // полосы, иначе лист освещается как вертикальная стенка.
    const t = (i + 1) / steps;
    const n = unit([-lean * 0.5, -curve * t * 0.5, 1]);
    quad(g,
      [a.c[0] - a.half, a.c[1], a.c[2]], [a.c[0] + a.half, a.c[1], a.c[2]],
      [b.c[0] + b.half, b.c[1], b.c[2]], [b.c[0] - b.half, b.c[1], b.c[2]],
      n, n, n, n);
    quad(g,
      [b.c[0] - b.half, b.c[1], b.c[2]], [b.c[0] + b.half, b.c[1], b.c[2]],
      [a.c[0] + a.half, a.c[1], a.c[2]], [a.c[0] - a.half, a.c[1], a.c[2]],
      n, n, n, n);
  }
  return g;
};

/* Комок глины/камня/листвы с неровной вершиной.
   Дёрганье ключуется по НАПРАВЛЕНИЮ вершины, а не по её индексу: по индексу
   соседние вершины получают разное смещение, и глыба рассыпается на осколки
   с щелями. По направлению общая точка получает одно и то же смещение, и
   комок остаётся цельным, просто неровным. */
const lumpGeo = (r, detail, seed, { squash = 0.72, jitter = 0.16 } = {}) => {
  const g = icosa(r, detail);
  for (let i = 0; i < g.p.length; i += 3) {
    const dir = unit([g.p[i], g.p[i + 1], g.p[i + 2]]);
    const key = Math.round(dir[0] * 89) * 73856093
      ^ Math.round(dir[1] * 127) * 19349663
      ^ Math.round(dir[2] * 151) * 83492791;
    const j = 1 + (noise(key, seed) - 0.5) * 2 * jitter;
    g.p[i] *= j;
    g.p[i + 1] *= j * squash;
    g.p[i + 2] *= j;
  }
  recalc(g);
  return g;
};

/* Зубец/шип: конус без нижней крышки. Ставится основанием вниз. */
const spikeGeo = (length, radius, seg = 5) => cyl(0, radius, length, seg, { flat: true, capBot: false });

// ---------- формы ----------
//
// Каждая форма принимает размеры слота (p.h, p.r) и палитру набора (c) и
// возвращает части. Размеры приходят числами, а не масштабом: слот — это
// место в наборе, и у другого набора те же числа другие.

// Хвоя: ярусы конусами. Ярус — главный носитель силуэта хвойного, поэтому
// их число и разброс задают вид, а не число треугольников.
const coniferTiers = (p, c, { tiers, bottom, top, seg = 8, taper = 0.2, width = 1 }) =>
  Array.from({ length: tiers }, (_, i) => {
    const t = tiers === 1 ? 0 : i / (tiers - 1);
    const y = p.h * bottom + (p.h * (top - bottom)) * t;
    const radius = p.r * width * (1 - t * 0.72);
    const height = p.h * (top - bottom) * (1.9 / tiers) + 0.1;
    const color = i % 2 === 0 ? c.needle : c.needleDark;
    return tierGeo(y - height * 0.35, radius, height, seg, taper, color);
  });

// Крона-купол из смещённых комков. Один шар читается мячом; три-четыре
// смещённых дают объём с неровной кромкой, а кромка и читается с расстояния.
// Крона-купол из смещённых комков: купол из нескольких сфер даёт объём с
// неровной кромкой, а одна сфера читается мячом. Комки обязаны
// перекрываться: разнесённые читаются как handful орехов на ветке, а не
// как крона, и «широкий купол сверху» превращается в кучу.
const domeCrown = (p, c, { blobs, color, spread = 1, lift = 0, width = 1 }) => {
  const out = [];
  for (let i = 0; i < blobs; i += 1) {
    const a = (i / blobs) * TAU + noise(i, 41) * 1.1;
    const reach = p.r * width * spread * (0.26 + noise(i, 42) * 0.3);
    const r = p.r * width * (blobs > 2 ? 0.74 : 0.92) * (0.86 + noise(i, 43) * 0.26);
    out.push(P(lumpGeo(r, 1, i + 7), i % 2 === 0 ? color : c.leafDark, {
      t: [Math.cos(a) * reach, p.h * (0.62 + lift + noise(i, 44) * 0.12), Math.sin(a) * reach],
    }));
  }
  return out;
};

// Голые ветви: расходящийся пучок плюс обломки. Читается пятном на фоне
// леса, и пятно держит именно контур ветвей, а не ствол.
const bareBranches = (c, base, count, reach, lift, radius, color, seed, { up = 0.35, stubs = 3 } = {}) => {
  const out = spray(base, count, reach, lift, radius, color, seed);
  for (let i = 0; i < stubs; i += 1) {
    const a = (i / stubs) * TAU + noise(i, seed + 9) * 1.4;
    const len = reach * (0.3 + noise(i, seed + 10) * 0.3);
    out.push(P(spikeGeo(len * 0.9, radius * 0.55, 4), c.barkDark, {
      t: [Math.cos(a) * reach * 0.5, base[1] + reach * up * 0.5, Math.sin(a) * reach * 0.5],
      r: [0, -a, 0.5 + noise(i, seed + 11) * 0.4],
    }));
  }
  return out;
};

// Корни: расходящиеся в стороны низкие трубы. У старого дерева и у пня они
// держат основание, иначе ствол читается как воткнутый в землю столб.
const rootGeo = (count, reach, radius, color, seed, y = 0.02) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * TAU + noise(i, seed) * 0.8;
    return P(tube(
      [
        [0, y + radius * 1.2, 0],
        [Math.cos(a) * reach * 0.5, y + radius * 0.7, Math.sin(a) * reach * 0.5],
        [Math.cos(a) * reach, y, Math.sin(a) * reach],
      ],
      [radius * 1.25, radius * 0.8, radius * 0.28],
      4,
      { capStart: false, capEnd: true },
    ), color);
  });

// Кладка: ряды блоков со смещением. Кладка читается числом рядов и их
// смещением, а раствор — зазором, а не отдельной геометрией: тень в
// промежутке даёт тот же рисунок на порядок дешевле.
//
// from/to — мировые координаты двух концов стены в плане, парой [x, z].
// Ряды идут вверх от y = 0, поэтому блок поставлен на высоту своего ряда, а
// не сдвинут вдоль нормали: сдвиг вдоль нормали уводил верхние ряды за
// пределы стены.
const masonry = (from, to, rows, cols, bw, bh, depth, color, seed) => {
  const out = [];
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const span = Math.hypot(dx, dz);
  if (span < 1e-6) return out;
  const dir = Math.atan2(dz, dx);
  const ux = dx / span, uz = dz / span;
  for (let r = 0; r < rows; r += 1) {
    const shift = r % 2 === 0 ? 0 : 0.5;
    for (let k = 0; k < cols; k += 1) {
      // Верхний ряд крошеный: блоки по краям ниже, и стена читается
      // обломанной, а не обрезанной по линейке.
      const crumble = r === rows - 1 ? 0.35 + noise(r * 13 + k, seed) * 0.6 : 1;
      const along = span * ((k + shift + 0.5) / cols) - span / 2;
      const wear = 0.88 + noise(r * 17 + k, seed + 3) * 0.2;
      out.push(P(boxGeo(bw * 0.9 * wear, bh * 0.88 * crumble, depth), color, {
        t: [from[0] + ux * along, r * bh, from[1] + uz * along],
        r: [0, -dir, 0],
      }));
    }
  }
  return out;
};

const FORMS = {
  // ---------- деревья ----------

  // Сосна высокая: крона высоко поднята, конус сужается, вершина плоская.
  // Отличие от ели — начало кроны: здесь 60% высоты, у елки от земли.
  pine: (p, c) => {
    const trunkH = p.h * 0.62;
    return [
      P(trunkGeo({ height: p.h * 0.98, radius: p.r * 0.13, top: 0.42, bend: p.r * 0.05, dir: 0.7, seg: 6 }), c.barkDark),
      ...coniferTiers(p, c, { tiers: 4, bottom: 0.58, top: 0.99, taper: 0.12 }),
      // Ветви торчат в стороны на трёх уровнях: у сосны они короткие и
      // голые, крона держится конусом, а не ими.
      ...[0, 1, 2].flatMap((level) => {
        const y = trunkH * (0.9 + level * 0.28);
        const reach = p.r * (0.5 - level * 0.1);
        return [0, 1, 2, 3].map((k) => P(
          branchGeo([0, y, 0], reach, p.r * 0.035, (k / 4) * TAU + level * 0.8, 0.1, 4), c.barkDark,
        ));
      }),
    ];
  },

  // Ель: крона от земли, четыре яруса, нижний самый широкий, ветви
  // горизонтальные с поднятыми концами. Ярусы и ветви шире, чем у сосны:
  // полоса слота у ели широкая, а её крона и должна быть широкой.
  spruce: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.55, radius: p.r * 0.16, top: 0.5, seg: 6 }), c.barkDark),
      ...coniferTiers(p, c, { tiers: 5, bottom: 0.02, top: 0.97, taper: 0.24, width: 1.28 }),
    ];
    for (let i = 0; i < 4; i += 1) {
      const t = i / 3;
      const y = p.h * (0.1 + t * 0.6);
      const reach = p.r * (1.28 - t * 0.66);
      for (let k = 0; k < 4; k += 1) {
        // Подъём конца 0.3…0.5 — тот самый признак ели: лапы горизонтальные,
        // но конец приподнят.
        out.push(P(
          branchGeo([0, y, 0], reach, p.r * 0.045, (k / 4) * TAU + i * 0.6, 0.3 + t * 0.2, 4),
          c.barkDark,
        ));
      }
    }
    return out;
  },

  // Лиственное широкое: низкий раздвоенный ствол, купол сверху, снизу
  // открыто. Самое широкое дерево набора.
  broadleaf: (p, c) => {
    const fork = p.h * 0.34;
    const out = [
      P(trunkGeo({ height: fork * 1.4, radius: p.r * 0.17, top: 0.8, bend: p.r * 0.12, dir: 2.1, seg: 6 }), c.bark),
    ];
    for (const side of [-1, 1]) {
      out.push(P(tube(
        [
          [0, fork, 0],
          [side * p.r * 0.3, fork + p.h * 0.16, p.r * 0.1],
          [side * p.r * 0.48, fork + p.h * 0.3, p.r * 0.18],
        ],
        [p.r * 0.11, p.r * 0.075, p.r * 0.04],
        5,
      ), c.bark));
    }
    out.push(...domeCrown(p, c, { blobs: 5, color: c.leaf, spread: 0.85, lift: 0.06, width: 0.9 }));
    // Подпорки от ствола к кроне: без них купол висит над стволом отдельно
    // и читается как облако на палке.
    for (const side of [-1, 1]) {
      out.push(P(branchGeo([side * p.r * 0.16, fork * 1.1, 0], p.r * 0.5, p.r * 0.05, side > 0 ? 0.5 : 2.6, 0.9, 4), c.bark));
    }
    return out;
  },

  // Берёза: тонкий светлый ствол с тёмными чёрточками, крона узкая и
  // рыхлая — кора видна сквозь листву. «Узкая» означает вытянутая вверх, а
  // не узкая в плане: комки кроны разнесены по высоте, и именно разброс по
  // вертикали держит пропорцию, которую требует полоса слота.
  birch: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.97, radius: p.r * 0.11, top: 0.4, bend: p.r * 0.16, dir: 0.4, seg: 6 }), c.barkLight),
    ];
    // Чёрточки на коре: тёмные полосы читаются как берёза на 11 пикселях
    // на единицу, а гладкий белый ствол — как столб.
    for (let i = 0; i < 5; i += 1) {
      const t = 0.16 + i * 0.15;
      const side = i % 2 === 0 ? 1 : -1;
      out.push(P(boxGeo(p.r * 0.2, p.r * 0.05, p.r * 0.04), c.barkDark, {
        t: [side * p.r * 0.11 * (1 - t * 0.5), p.h * t, p.r * 0.05 * side],
        r: [0, side > 0 ? 0.3 : -0.3, 0],
      }));
    }
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + 0.6;
      const y = p.h * (0.6 + i * 0.09);
      out.push(P(lumpGeo(p.r * (0.44 - i * 0.04), 1, i + 21), i % 2 === 0 ? c.leaf : c.leafLight, {
        t: [Math.cos(a) * p.r * 0.5, y, Math.sin(a) * p.r * 0.5],
      }));
      out.push(P(branchGeo([0, y - p.h * 0.06, 0], p.r * 0.48, p.r * 0.035, a, 0.5, 4), c.barkLight));
    }
    return out;
  },

  // Тополь: прямой ствол, крона узкая и вертикальная, верхушка острая.
  poplar: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.96, radius: p.r * 0.1, top: 0.45, seg: 6 }), c.bark),
    ];
    for (let i = 0; i < 5; i += 1) {
      const t = i / 4;
      const y = p.h * (0.46 + t * 0.4);
      out.push(P(lumpGeo(p.r * (0.81 - t * 0.34), 1, i + 31), i % 2 === 0 ? c.leaf : c.leafDark, {
        t: [noise(i, 51) * p.r * 0.12, y, noise(i, 52) * p.r * 0.12],
        s: [1, 1.25, 1],
      }));
    }
    // Острая верхушка — то, чем тополь отличается от ели и берёзы: силуэт
    // сходит в шпиль, а не в купол или ярус.
    out.push(P(spikeGeo(p.h * 0.16, p.r * 0.28, 6), c.leafDark, { t: [0, p.h * 0.86, 0] }));
    return out;
  },

  // Ореш: ствол разламывается в три ветви от трети высоты, крона
  // шарообразная и плотная.
  hazel: (p, c) => {
    const fork = p.h * 0.3;
    const out = [P(trunkGeo({ height: fork * 1.3, radius: p.r * 0.15, top: 0.9, seg: 6 }), c.bark)];
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + 0.4;
      out.push(P(tube(
        [
          [0, fork, 0],
          [Math.cos(a) * p.r * 0.22, fork + p.h * 0.14, Math.sin(a) * p.r * 0.22],
          [Math.cos(a) * p.r * 0.44, fork + p.h * 0.28, Math.sin(a) * p.r * 0.44],
        ],
        [p.r * 0.1, p.r * 0.07, p.r * 0.045],
        5,
      ), c.bark));
    }
    out.push(P(lumpGeo(p.r * 0.54, 1, 61), c.leaf, { t: [0, p.h * 0.66, 0] }));
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + 1.1;
      out.push(P(lumpGeo(p.r * 0.36, 1, 62 + i), i % 2 === 0 ? c.leafDark : c.leaf, {
        t: [Math.cos(a) * p.r * 0.33, p.h * (0.54 + i * 0.04), Math.sin(a) * p.r * 0.33],
      }));
    }
    return out;
  },

  // Сухостой: без листвы, голые ветви вверх и в стороны, обломки. Тёмный
  // силуэт: на фоне леса читается пятном.
  deadwood: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.72, radius: p.r * 0.15, top: 0.55, bend: p.r * 0.1, dir: 1.9, seg: 6 }), c.deadDark),
    ];
    out.push(...bareBranches(c, [0, p.h * 0.68, 0], 6, p.r * 0.7, 0.85, p.r * 0.05, c.dead, 71, { up: 0.9, stubs: 3 }));
    out.push(...bareBranches(c, [0, p.h * 0.44, 0], 4, p.r * 0.62, 0.3, p.r * 0.045, c.dead, 72, { up: 0.3, stubs: 2 }));
    // Обломок у корня: у сухостоя он держит асимметрию, без него ствол
    // симметричен и читается как столб.
    out.push(P(tube(
      [[0, p.h * 0.05, 0], [p.r * 0.5, p.h * 0.14, p.r * 0.2], [p.r * 0.8, p.h * 0.1, p.r * 0.3]],
      [p.r * 0.13, p.r * 0.1, p.r * 0.05],
      5,
    ), c.deadDark));
    return out;
  },

  // Старое кривое дерево: ствол с изгибом, одна сторона кроны обломана, у
  // корня корни в стороны. Асимметрия — главный признак.
  oldTree: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.62, radius: p.r * 0.19, top: 0.6, bend: p.r * 0.3, dir: 0.3, seg: 6 }), c.bark),
      ...rootGeo(4, p.r * 0.68, p.r * 0.1, c.barkDark, 81),
    ];
    // Крона смещена и обломана с одной стороны: три комка на одном краю и
    // один на другом, пустота между ними и есть облом.
    for (let i = 0; i < 3; i += 1) {
      const a = 0.4 + i * 0.7;
      out.push(P(lumpGeo(p.r * (0.36 - i * 0.05), 1, 82 + i), i % 2 === 0 ? c.leaf : c.leafDark, {
        t: [Math.cos(a) * p.r * 0.4, p.h * (0.66 + i * 0.08), Math.sin(a) * p.r * 0.4],
      }));
    }
    out.push(P(lumpGeo(p.r * 0.4, 1, 89), c.leaf, { t: [-p.r * 0.34, p.h * 0.72, -p.r * 0.24] }));
    // Скол на стволе — светлая свежесть: на тёмном стволе это единственное
    // пятно другого тона, и оно читается как слом.
    out.push(P(boxGeo(p.r * 0.22, p.r * 0.3, p.r * 0.1), c.barkLight, {
      t: [p.r * 0.16, p.h * 0.5, p.r * 0.12], r: [0.2, 0.6, 0.3],
    }));
    return out;
  },

  // Молодое деревце: тонкий стволик, крона маленькая и круглая вся в
  // нижней половине высоты. Читается пропорцией, а не высотой.
  sapling: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.6, radius: p.r * 0.1, top: 0.6, bend: p.r * 0.08, dir: 0.9, seg: 5 }), c.barkLight),
    ];
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + 0.3;
      out.push(P(lumpGeo(p.r * (0.37 - i * 0.035), 1, 91 + i), i % 2 === 0 ? c.leaf : c.leafLight, {
        t: [Math.cos(a) * p.r * 0.26, p.h * (0.34 + i * 0.07), Math.sin(a) * p.r * 0.26],
      }));
    }
    out.push(P(lumpGeo(p.r * 0.28, 1, 97), c.leaf, { t: [0, p.h * 0.5, 0] }));
    return out;
  },

  // Наклонённое дерево: ствол под углом, крона смещена в сторону наклона,
  // основание перекосено. Наклон задан изгибом ствола, а не поворотом
  // всей модели: поворот унёс бы основание из земли, и пропс повис бы.
  leaningTree: (p, c) => {
    const out = [
      P(trunkGeo({ height: p.h * 0.6, radius: p.r * 0.15, top: 0.6, bend: p.r * 0.5, dir: 0, seg: 6 }), c.bark),
      // Перекошенное основание: корни в одну сторону плюс короткий откос.
      ...rootGeo(3, p.r * 0.5, p.r * 0.1, c.barkDark, 101),
      P(lumpGeo(p.r * 0.2, 0, 102), c.bark, { t: [-p.r * 0.34, 0, 0], s: [1.4, 0.5, 1.4] }),
    ];
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + 0.2;
      out.push(P(lumpGeo(p.r * (0.3 - i * 0.035), 1, 103 + i), i % 2 === 0 ? c.leaf : c.leafDark, {
        t: [
          Math.cos(a) * p.r * 0.3 + p.r * 0.44,
          p.h * (0.6 + i * 0.07),
          Math.sin(a) * p.r * 0.3,
        ],
      }));
    }
    // Ствол-подкос: наклон без выправляющей ветки читается как сдвиг, а не
    // как наклон.
    out.push(P(tube(
      [[-p.r * 0.1, p.h * 0.18, 0], [p.r * 0.3, p.h * 0.42, 0], [p.r * 0.52, p.h * 0.55, 0]],
      [p.r * 0.07, p.r * 0.05, p.r * 0.03],
      4,
    ), c.bark));
    return out;
  },

  // ---------- кустарники ----------

  // Куст: шар из отдельных веток с неровной кромкой. Сегментов по пять, не
  // больше: куст занимает 180 треугольников, и шесть ветвей на сегмент
  // переставали влезать вместе с комками кроны.
  bush: (p, c) => {
    const out = spray([0, p.h * 0.1, 0], 5, p.r * 0.7, 0.7, p.r * 0.07, c.bark, 111, 3);
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + 0.5;
      out.push(P(lumpGeo(p.r * 0.46, 0, 112 + i), i % 2 === 0 ? c.leaf : c.leafDark, {
        t: [Math.cos(a) * p.r * 0.4, p.h * (0.48 + i * 0.1), Math.sin(a) * p.r * 0.4],
      }));
    }
    return out;
  },

  // Ежевичник: ползёт по земле, шире чем выше, по краю отдельные плети с
  // колючками.
  bramble: (p, c) => {
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + 0.2;
      const reach = p.r * (0.37 + noise(i, 121) * 0.17);
      out.push(P(tube(
        [
          [0, p.h * 0.16, 0],
          [Math.cos(a) * reach * 0.55, p.h * 0.42, Math.sin(a) * reach * 0.55],
          [Math.cos(a) * reach, p.h * 0.1, Math.sin(a) * reach],
        ],
        [p.r * 0.05, p.r * 0.045, p.r * 0.02],
        3,
      ), c.barkDark));
      // Плети у земли: ширина важнее высоты, а колючки дают неровную кромку,
      // по которой куст отличается от гладкого пятна.
      out.push(P(lumpGeo(p.r * 0.3, 0, 122 + i), c.leafDark, {
        t: [Math.cos(a) * reach * 0.72, p.h * 0.3, Math.sin(a) * reach * 0.72],
      }));
      out.push(P(spikeGeo(p.h * 0.22, p.r * 0.03, 3), c.dead, {
        t: [Math.cos(a) * reach * 0.9, p.h * 0.14, Math.sin(a) * reach * 0.9],
        r: [0, -a, 0.9],
      }));
    }
    return out;
  },

  // Цветущий куст: тёмная зелень и заметные пятна цветов. Пятна светлее
  // зелени настолько, что читаются отдельными, а не сливаются.
  floweringBush: (p, c) => {
    const out = spray([0, p.h * 0.08, 0], 4, p.r * 0.62, 0.6, p.r * 0.06, c.barkDark, 131, 3);
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + 0.7;
      out.push(P(lumpGeo(p.r * 0.44, 0, 132 + i), c.leafDark, {
        t: [Math.cos(a) * p.r * 0.36, p.h * (0.46 + i * 0.12), Math.sin(a) * p.r * 0.36],
      }));
    }
    // Цветы по краю кроны: вблизи это пятна, с расстояния — светлые точки
    // на тёмном фоне, и именно они отличают куст от прочих кустарников.
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU + 0.3;
      out.push(P(octa(p.r * 0.1), c.flower, {
        t: [Math.cos(a) * p.r * 0.72, p.h * (0.55 + noise(i, 133) * 0.28), Math.sin(a) * p.r * 0.72],
      }));
    }
    return out;
  },

  // Низкий ползучий куст: совсем низкий и широкий, прижат к земле.
  creeper: (p, c) => {
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU + 0.9;
      const reach = p.r * (0.25 + noise(i, 141) * 0.18);
      out.push(P(lumpGeo(p.r * 0.3, 0, 142 + i), i % 2 === 0 ? c.leaf : c.leafDark, {
        t: [Math.cos(a) * reach, p.h * 0.3, Math.sin(a) * reach],
        s: [1, 0.5, 1],
      }));
    }
    out.push(P(lumpGeo(p.r * 0.46, 0, 149), c.leaf, { t: [0, p.h * 0.34, 0], s: [1, 0.45, 1] }));
    return out;
  },

  // Кочка травы: пучок длинных заострённых blades, земля видна сквозь
  // крону. Пустота в центре — часть силуэта.
  grassTuft: (p, c) => {
    const out = [];
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU + noise(i, 151) * 0.7;
      const lean = 0.25 + noise(i, 152) * 0.55;
      out.push(P(bladeGeo(p.h * (0.7 + noise(i, 153) * 0.45), p.r * 0.26, {
        curve: 0.7 + noise(i, 154) * 0.6,
        lean,
        taper: 0.05,
        steps: 2,
      }), i % 3 === 0 ? c.leafLight : c.leaf, { r: [0, a, 0] }));
    }
    return out;
  },

  // Папоротник: раскрытые листья веером из одной точки, лист рассечённый.
  fern: (p, c) => {
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + 0.5;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const reach = p.r * 0.8;
      // Черешок: от одной точки в стороны и вверх.
      out.push(P(tube(
        [
          [0, p.h * 0.05, 0],
          [cosA * reach * 0.5, p.h * 0.5, sinA * reach * 0.5],
          [cosA * reach, p.h * 0.66, sinA * reach],
        ],
        [p.r * 0.04, p.r * 0.03, p.r * 0.015],
        3,
      ), c.leafDark));
      // Рассечённый лист: доли по обе стороны от черешка, и именно они дают
      // «папоротник» — сплошная лента читалась бы как трава.
      for (let k = 1; k <= 3; k += 1) {
        const t = k / 4;
        for (const side of [-1, 1]) {
          out.push(P(bladeGeo(p.h * 0.3 * (1 - t * 0.4), p.r * 0.2, {
            curve: 0.3, lean: 0.8, taper: 0.1, steps: 1,
          }), k % 2 === 0 ? c.leaf : c.leafDark, {
            t: [cosA * reach * t, p.h * (0.1 + t * 0.52), sinA * reach * t],
            r: [0, a + side * 1.1, 0.5],
          }));
        }
      }
    }
    return out;
  },

  // ---------- камни ----------

  // Камень мелкий: глыба с двумя-тремя гранями, острой вершиной.
  smallRock: (p, c) => [
    P(lumpGeo(p.r * 0.85, 1, 161), c.rock, { s: [1, 1.1, 0.95], r: [0.1, 0.5, 0.05] }),
    P(lumpGeo(p.r * 0.5, 0, 162), c.rockLight, { t: [p.r * 0.1, p.h * 0.62, 0], s: [0.8, 1.2, 0.8] }),
    P(lumpGeo(p.r * 0.36, 0, 163), c.rock, { t: [-p.r * 0.5, p.h * 0.2, p.r * 0.3], s: [1.2, 0.7, 1] }),
  ],

  // Камень средний: округлая глыба, скол сбоку. Скол читается как вмятина
  // контура, а не как отдельная деталь.
  mediumRock: (p, c) => [
    P(lumpGeo(p.r * 0.9, 1, 171), c.rock, { s: [1, 0.92, 1.05] }),
    P(lumpGeo(p.r * 0.44, 0, 172), c.rockDark, {
      t: [p.r * 0.55, p.h * 0.42, p.r * 0.34], s: [0.7, 1, 0.9],
    }),
    P(lumpGeo(p.r * 0.34, 0, 173), c.rockLight, { t: [-p.r * 0.3, p.h * 0.72, -p.r * 0.2] }),
  ],

  // Валун: крупный, сверху плоский, с расколом пополам. Настоящий камень-
  // препятствие, поэтому он самый высокий из камней.
  boulder: (p, c) => [
    P(lumpGeo(p.r * 0.95, 1, 181), c.rock, { s: [1, 0.86, 1] }),
    // Плоская вершина: два усечённых конуса вместо шара дают ровную площадку,
    // и на ней валун читается как препятствие, а не как валун-капля.
    P(cyl(p.r * 0.5, p.r * 0.86, p.h * 0.2, 9, { flat: true }), c.rockLight, { t: [0, p.h * 0.66, 0] }),
    // Раскол: тёмная щель пополам плюс смещённая половина. Щель читается
    // вертикальной линией, и это отличает валун от просто большого камня.
    P(boxGeo(p.r * 0.1, p.h * 0.5, p.r * 1.9), c.rockDark, {
      t: [p.r * 0.06, p.h * 0.1, 0], r: [0, 0.25, 0.06],
    }),
    P(lumpGeo(p.r * 0.5, 0, 182), c.rock, { t: [p.r * 0.42, p.h * 0.2, -p.r * 0.16], s: [0.6, 1.1, 1] }),
  ],

  // Скальная гряда: длинный вытянутый гребень с острыми зубьями сверху.
  // Читается как препятствие издалека — это и есть его работа на карте.
  cragRidge: (p, c) => {
    const out = [
      P(tube(
        [
          [-p.r * 1.15, p.h * 0.2, 0],
          [-p.r * 0.4, p.h * 0.5, p.r * 0.1],
          [p.r * 0.4, p.h * 0.44, -p.r * 0.1],
          [p.r * 1.15, p.h * 0.22, 0],
        ],
        [p.r * 0.3, p.r * 0.46, p.r * 0.44, p.r * 0.28],
        6,
      ), c.rock),
    ];
    // Зубья: острые и разной высоты, иначе гряда читается как труба.
    for (let i = 0; i < 5; i += 1) {
      const t = i / 4;
      const x = p.r * (-1 + t * 2);
      const h = p.h * (0.3 + noise(i, 191) * 0.45);
      out.push(P(spikeGeo(h, p.r * (0.16 + noise(i, 192) * 0.1), 4), c.rockLight, {
        t: [x, p.h * 0.42, noise(i, 193) * p.r * 0.12],
        r: [noise(i, 194) * 0.2, 0, noise(i, 195) * 0.25],
      }));
    }
    return out;
  },

  // Плита: плоская лежачая плита с двумя сколами, сильно шире чем выше.
  // Полоса слота требует отношение ширины к высоте около полутора, поэтому
  // плита именно плоская: поднятая вдвое к высоте грань читалась бы как
  // второй камень рядом.
  slab: (p, c) => [
    P(boxGeo(p.r * 1.7, p.h * 0.7, p.r * 1.2), c.rock, { t: [0, 0, 0], r: [0, 0.3, 0.02] }),
    P(boxGeo(p.r * 1.36, p.h * 0.66, p.r * 1.02), c.rockLight, { t: [-p.r * 0.13, 0, 0], r: [0.03, -0.2, -0.02] }),
    P(lumpGeo(p.r * 0.26, 0, 201), c.rockDark, { t: [p.r * 0.68, p.h * 0.2, p.r * 0.42], s: [0.8, 0.9, 1] }),
    P(boxGeo(p.r * 0.42, p.h * 0.3, p.r * 0.34), c.rockDark, { t: [-p.r * 0.6, p.h * 0.3, -p.r * 0.34], r: [0.2, 0.5, 0.4] }),
  ],

  // Сланцевый блок, плоский: стопка трёх плоских пластин с ровными краями,
  // как сложенные книги. Ровные края — главный признак.
  slateStack: (p, c) => {
    const out = [];
    for (let i = 0; i < 3; i += 1) {
      out.push(P(boxGeo(p.r * 1.9 - i * p.r * 0.18, p.h * 0.3, p.r * 1.3 - i * p.r * 0.12), i % 2 === 0 ? c.slate : c.slateLight, {
        t: [i * p.r * 0.06, i * p.h * 0.3, 0],
        r: [0, 0.16 - i * 0.14, 0],
      }));
    }
    return out;
  },

  // Камень в моху: у основания зелёный мох, верхняя часть светлее камня под
  // ним. Два тона по высоте читаются как «мокрое снизу».
  mossyRock: (p, c) => [
    P(lumpGeo(p.r * 0.82, 1, 211), c.rock),
    P(lumpGeo(p.r * 0.52, 0, 212), c.rockLight, { t: [p.r * 0.12, p.h * 0.72, -p.r * 0.08] }),
    P(lumpGeo(p.r * 0.95, 1, 213), c.moss, {
      t: [0, p.h * 0.14, 0], s: [1, 0.3, 1],
    }),
    P(lumpGeo(p.r * 0.34, 0, 214), c.moss, { t: [-p.r * 0.62, p.h * 0.1, p.r * 0.44], s: [1, 0.4, 1] }),
  ],

  // Россыпь мелких камней: плоская россыпь из десятка камешков разного
  // размера, а не один объём. Плоская — часть силуэта.
  pebbles: (p, c) => {
    const out = [];
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * TAU + noise(i, 221) * 1.4;
      const reach = p.r * (0.25 + noise(i, 222) * 0.7);
      const r = p.r * (0.14 + noise(i, 223) * 0.2);
      out.push(P(lumpGeo(r, 0, 224 + i), i % 3 === 0 ? c.rockLight : c.rock, {
        t: [Math.cos(a) * reach, r * 0.3, Math.sin(a) * reach],
        s: [1, 0.62, 1],
        r: [0, noise(i, 225) * TAU, 0],
      }));
    }
    return out;
  },

  // ---------- упавшее и разное ----------

  // Поваленное дерево: упавший ствол с обломанными сучьями, один конец
  // свежее и светлее. Длинная горизонталь — главный признак.
  fallenTree: (p, c) => {
    const out = [
      P(tube(
        [
          [-p.r * 0.85, p.r * 0.22, 0],
          [-p.r * 0.22, p.r * 0.26, p.r * 0.06],
          [p.r * 0.44, p.r * 0.24, -p.r * 0.05],
          [p.r * 0.88, p.r * 0.2, 0],
        ],
        [p.r * 0.18, p.r * 0.22, p.r * 0.18, p.r * 0.14],
        6,
      ), c.bark),
      // Свежий скол на конце: светлая плоскость на тёмном стволе держит
      // направление, иначе бревно читается как бесформенное пятно.
      P(cyl(p.r * 0.13, p.r * 0.15, p.r * 0.09, 6, { flat: true }), c.barkLight, {
        t: [p.r * 0.92, p.r * 0.2, 0], r: [0, 0, -Math.PI / 2],
      }),
    ];
    for (let i = 0; i < 3; i += 1) {
      const a = 0.6 + i * 1.9;
      out.push(P(tube(
        [
          [p.r * (-0.5 + i * 0.45), p.r * 0.24, 0],
          [p.r * (-0.5 + i * 0.45) + Math.cos(a) * p.r * 0.22, p.r * 0.42, Math.sin(a) * p.r * 0.15],
        ],
        [p.r * 0.07, p.r * 0.025],
        4,
      ), c.barkDark));
    }
    return out;
  },

  // Пень: спил, ровная светлая верхушка, корни расходятся в стороны, вокруг
  // щепки.
  stump: (p, c) => [
    P(cyl(p.r * 0.72, p.r * 0.86, p.h * 0.82, 8, { flat: true }), c.bark),
    P(cyl(p.r * 0.66, p.r * 0.66, p.r * 0.06, 8, { flat: true }), c.barkLight, { t: [0, p.h * 0.82, 0] }),
    ...rootGeo(4, p.r * 1.05, p.r * 0.14, c.barkDark, 231),
    P(lumpGeo(p.r * 0.16, 0, 232), c.barkLight, { t: [p.r * 0.9, p.r * 0.06, p.r * 0.5], r: [0, 0.5, 0.2] }),
    P(lumpGeo(p.r * 0.12, 0, 233), c.barkLight, { t: [-p.r * 0.8, p.r * 0.05, -p.r * 0.6], r: [0.2, 1.2, 0.1] }),
  ],

  // Сломанная ветка: тонкая изогнутая ветвь на земле, одна развилка.
  // Самая плоская модель набора.
  brokenBranch: (p, c) => [
    P(tube(
      [
        [-p.r * 0.95, p.r * 0.1, 0],
        [-p.r * 0.3, p.r * 0.16, p.r * 0.14],
        [p.r * 0.35, p.r * 0.13, -p.r * 0.1],
        [p.r * 0.95, p.r * 0.09, 0],
      ],
      [p.r * 0.09, p.r * 0.11, p.r * 0.07, p.r * 0.035],
      5,
    ), c.bark),
    P(tube(
      [[p.r * 0.1, p.r * 0.13, 0], [p.r * 0.45, p.r * 0.3, p.r * 0.3]],
      [p.r * 0.06, p.r * 0.025],
      4,
    ), c.barkLight),
  ],

  // Корневая плита: вывороченный пласт земли с корнями вверх, корни как
  // рёбра. Рёбра читаются, а ком земли — нет.
  rootPlate: (p, c) => [
    P(boxGeo(p.r * 1.7, p.h * 0.4, p.r * 1.2), c.soil, { t: [0, 0, 0], r: [0.12, 0.2, -0.06] }),
    P(lumpGeo(p.r * 0.8, 0, 241), c.soil, { t: [0, p.h * 0.2, 0], s: [1.2, 0.5, 1] }),
    ...rootGeo(5, p.r * 0.8, p.r * 0.1, c.barkDark, 242, p.h * 0.35),
    P(lumpGeo(p.r * 0.22, 0, 243), c.barkDark, { t: [p.r * 0.5, p.h * 0.5, -p.r * 0.3], s: [1.2, 1.4, 1] }),
  ],

  // Доски: несколько досок крест-накрест, одна посередине просела.
  planks: (p, c) => [
    P(boxGeo(p.r * 1.9, p.r * 0.08, p.r * 0.42), c.wood, { t: [0, p.r * 0.08, 0], r: [0, 0.1, 0.03] }),
    P(boxGeo(p.r * 1.7, p.r * 0.08, p.r * 0.38), c.woodDark, { t: [p.r * 0.1, p.r * 0.16, 0], r: [0, 1.24, -0.04] }),
    P(boxGeo(p.r * 1.5, p.r * 0.07, p.r * 0.36), c.wood, { t: [-p.r * 0.15, p.r * 0.1, p.r * 0.2], r: [0, 0.5, 0.06] }),
    // Просевшая доска: излом в середине, и это то, что отличает кучу досок
    // от ровного настила.
    P(tube(
      [[-p.r * 0.7, p.r * 0.16, -p.r * 0.28], [0, p.r * 0.04, -p.r * 0.34], [p.r * 0.8, p.r * 0.14, -p.r * 0.28]],
      [p.r * 0.15, p.r * 0.15, p.r * 0.15],
      4,
    ), c.woodDark),
  ],

  // Хворост: пучок тонких веток, собранных вместе, концы торчат в разные
  // стороны. Пучок читается пересечением линий.
  twigs: (p, c) => {
    const out = [];
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * TAU + noise(i, 251) * 1.2;
      const reach = p.r * (0.6 + noise(i, 252) * 0.28);
      out.push(P(tube(
        [
          [Math.cos(a) * p.r * 0.2, p.h * 0.5, Math.sin(a) * p.r * 0.2],
          [Math.cos(a) * reach * 0.6, p.h * (0.3 + noise(i, 253) * 0.4), Math.sin(a) * reach * 0.6],
          [Math.cos(a) * reach, p.h * (0.15 + noise(i, 254) * 0.5), Math.sin(a) * reach],
        ],
        [p.r * 0.055, p.r * 0.045, p.r * 0.02],
        4,
      ), i % 2 === 0 ? c.bark : c.barkDark));
    }
    return out;
  },

  // ---------- руины ----------

  // Колонна: цилиндр с базой и капителью, верх неровный или сколотый.
  // Тонкая вертикаль на фоне деревьев.
  column: (p, c) => {
    const shaft = p.h * 0.76;
    const out = [
      P(boxGeo(p.r * 1.7, p.h * 0.08, p.r * 1.7), c.stone, { t: [0, 0, 0] }),
      P(boxGeo(p.r * 1.35, p.h * 0.07, p.r * 1.35), c.stoneLight, { t: [0, p.h * 0.08, 0] }),
      P(cyl(p.r * 0.82, p.r * 0.92, shaft, 10, { flat: true, capBot: false }), c.stone, { t: [0, p.h * 0.15, 0] }),
      // Капитель: без неё цилиндр читается как труба, а колонна — как
      // архитектура.
      P(cyl(p.r * 1.15, p.r * 0.84, p.h * 0.09, 10, { flat: true }), c.stoneLight, { t: [0, p.h * 0.15 + shaft, 0] }),
      P(boxGeo(p.r * 1.9, p.h * 0.06, p.r * 1.9), c.stone, { t: [0, p.h * 0.15 + shaft + p.h * 0.09, 0] }),
    ];
    // Скол наверху: неровная кромка из двух блоков разной высоты вместо
    // ровного среза.
    out.push(P(boxGeo(p.r * 1.1, p.h * 0.1, p.r * 1.5), c.stone, {
      t: [0, p.h * 0.15 + shaft + p.h * 0.15, 0], r: [0.06, 0.2, 0.04],
    }));
    out.push(P(boxGeo(p.r * 0.5, p.h * 0.06, p.r * 0.5), c.stoneLight, {
      t: [p.r * 0.6, p.h * 0.15 + shaft + p.h * 0.19, p.r * 0.3], r: [0.2, 0.5, 0.3],
    }));
    return out;
  },

  // Арка: проём с аркой над ним, одна стойка чуть короче другой. Разная
  // высота стоек — намёк на разрушение, и он виден с любой стороны.
  arch: (p, c) => {
    const out = [];
    // Стойки стоят вдоль Z: у проёма две тонкие опоры по краям, а не
    // массивные пилоны. Ширина проёма — треть радиуса слота.
    for (let i = 0; i < 2; i += 1) {
      const x = (i === 0 ? -1 : 1) * p.r * 0.75;
      const rows = i === 0 ? 3 : 2;
      out.push(...masonry(
        [x, -p.r * 0.3], [x, p.r * 0.3],
        rows, 2, p.r * 0.62, p.h * 0.19, p.r * 0.55,
        i === 0 ? c.stone : c.stoneDark, 261 + i,
      ));
    }
    // Арка: клинья по дуге. Дуга из плоских клиньев читается как арка,
    // а из гнутой трубы — как труба.
    const segs = 6;
    for (let i = 0; i < segs; i += 1) {
      const t = (i + 0.5) / segs;
      const a = Math.PI * (1 - t);
      out.push(P(boxGeo(p.r * 0.5, p.h * 0.12, p.r * 0.55), i % 2 === 0 ? c.stone : c.stoneLight, {
        t: [Math.cos(a) * p.r * 0.75, p.h * 0.57 + Math.sin(a) * p.h * 0.28, 0],
        r: [0, 0, a - Math.PI / 2],
      }));
    }
    out.push(P(boxGeo(p.r * 1.9, p.h * 0.09, p.r * 0.62), c.stone, { t: [0, p.h * 0.92, 0] }));
    return out;
  },

  // Стена: прямая стена из ровных рядов кладки, верх крошеный, скол у края.
  // Стена узкая по глубине и длинная по фронту, а высоты достигает числом
  // рядов: полоса слота требует высоты в полтора раза больше ширины, и
  // добрать её стеной вбок нельзя — она перестала бы быть стеной.
  wall: (p, c) => [
    ...masonry([-p.r * 0.74, 0], [p.r * 0.74, 0], 6, 4, p.r * 0.4, p.h / 6, p.r * 0.4, c.stone, 271),
    // Скол у края: блок сбит и лежит на месте — край стены читается рваным,
    // а ровная стена читалась бы как забор.
    P(boxGeo(p.r * 0.4, p.h * 0.14, p.r * 0.4), c.stoneDark, {
      t: [-p.r * 0.7, p.h * 0.33, p.r * 0.1], r: [0.35, 0.4, 0.3],
    }),
    P(lumpGeo(p.r * 0.18, 0, 273), c.rubble, { t: [p.r * 0.7, p.r * 0.05, p.r * 0.4] }),
  ],

  // Супени: четыре ступени подъёма, края стёртые, передняя ступень шире.
  steps: (p, c) => {
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const w = p.r * (1.55 - i * 0.16);
      const d = p.r * 1.1;
      const y = p.h * 0.25 * i;
      // Верхний угол ступени сбит: стёртость читается скошенной кромкой,
      // а ровный угол — как новый бетон.
      out.push(P(boxGeo(w, p.h * 0.25, d), c.stone, { t: [0, y, (i - 1.5) * p.r * 0.22] }));
      out.push(P(boxGeo(w * 0.96, p.h * 0.25, d * 0.9), c.stoneLight, {
        t: [w * 0.04, y, (i - 1.5) * p.r * 0.22 + p.r * 0.05], r: [0.04, 0, 0.03],
      }));
    }
    return out;
  },

  // Алтарь: плита на двух опорах, сверху ровная площадка, на ней ничего нет.
  // Пустота над площадкой — часть силуэта: алтарь без пустоты читается как
  // ком, а опоры под плитой читаются как ножки.
  altar: (p, c) => [
    P(boxGeo(p.r * 1.7, p.h * 0.1, p.r * 1.25), c.stoneDark, { t: [0, 0, 0] }),
    P(boxGeo(p.r * 0.32, p.h * 0.78, p.r * 0.9), c.stone, { t: [-p.r * 0.54, p.h * 0.1, 0] }),
    P(boxGeo(p.r * 0.32, p.h * 0.78, p.r * 0.9), c.stone, { t: [p.r * 0.54, p.h * 0.1, 0] }),
    // Равная площадка сверху и ничего на ней.
    P(boxGeo(p.r * 1.75, p.h * 0.12, p.r * 1.3), c.stoneLight, { t: [0, p.h * 0.88, 0] }),
    P(boxGeo(p.r * 1.5, p.h * 0.06, p.r * 1.05), c.stone, { t: [0, p.h * 0.94, 0], r: [0, 0.1, 0] }),
  ],

  // Колодец: круглая каменная кладка сверху и вход, темнота внутри, две
  // деревянные стойки по краям.
  well: (p, c) => {
    const out = [];
    const segs = 8;
    for (let i = 0; i < segs; i += 1) {
      const a = (i / segs) * TAU;
      const x = Math.cos(a) * p.r * 0.8;
      const z = Math.sin(a) * p.r * 0.8;
      out.push(P(boxGeo(p.r * 0.52, p.h * 0.52, p.r * 0.42), i % 2 === 0 ? c.stone : c.stoneLight, {
        t: [x, 0, z], r: [0, -a, 0],
      }));
    }
    // Темнота внутри: тёмный диск ниже кромки. Он читается как проём, и
    // именно он отличает колодец от круглой тумбы.
    out.push(P(cyl(p.r * 0.6, p.r * 0.6, p.r * 0.04, 8, { flat: true }), c.hollow, { t: [0, p.h * 0.06, 0] }));
    out.push(P(torusRing(p.r * 0.78, p.r * 0.1, 8), c.stoneLight, { t: [0, p.h * 0.52, 0] }));
    // Деревянные стойки по краям: вход держится на них, и две вертикали
    // дают узнаваемый силуэт колодца.
    for (const side of [-1, 1]) {
      out.push(P(boxGeo(p.r * 0.14, p.h * 0.5, p.r * 0.14), c.wood, { t: [side * p.r * 0.78, p.h * 0.52, 0] }));
    }
    out.push(P(boxGeo(p.r * 1.8, p.r * 0.1, p.r * 0.16), c.woodDark, { t: [0, p.h * 0.52 + p.h * 0.5, 0] }));
    return out;
  },

  // ---------- кости ----------

  // Череп: глыба с вытянутой мордой и двумя провалами глаз. Лежит лицевой
  // стороной вверх — именно так два глаза видны сразу, и на 7 пикселях это
  // единственная ориентация, в которой провалы читаются пятнами, а не
  // двумя точками сбоку.
  //
  // Провалы не вырезаны: вырезание стоило бы отдельной геометрии и целого
  // треугольника бюджета ради двух пятен. Вместо этого тёмные ромбы лежат
  // плоскостью по нормали лица и утоплены в череп — на экране это тёмные
  // вмятины, и разница с выпуклым тёмным выступом видна сразу.
  skull: (p, c) => {
    const R = p.r;
    const out = [
      // Черепная коробка: слегка сплющена, морда сужается вперёд.
      P(lumpGeo(R * 0.62, 1, 281, { squash: 0.86, jitter: 0.1 }), c.bone, {
        t: [0, R * 0.62, 0], s: [1, 1, 1.04],
      }),
      // Переход к морде: икосаэдр нулевой детализации, детальнее он не
      // читается (три треугольника против восьмидесяти), а слот держит 200.
      P(lumpGeo(R * 0.42, 0, 282, { squash: 0.8, jitter: 0.09 }), c.bone, {
        t: [R * 0.62, R * 0.5, 0], s: [1.2, 0.85, 0.9],
      }),
      // Морда: сужается и опускается, без неё глыба читается как булыжник.
      P(cyl(R * 0.2, R * 0.36, R * 0.34, 6, { flat: true, capTop: false }), c.bone, {
        t: [R * 0.76, R * 0.4, 0], r: [0, 0, -Math.PI / 2],
      }),
      // Надбровье: даёт черепу перемычку между глазами и над ними, и без неё
      // лицо читается как гладкая глыба.
      P(boxGeo(R * 0.5, R * 0.16, R * 0.78), c.bone, { t: [R * 0.3, R * 0.92, 0], r: [0.2, 0, 0.1] }),
      // Провалы глаз: плоский ромб, утопленный в верх черепа.
      ...[-1, 1].map((side) => P(octa(R * 0.26), c.hollow, {
        t: [R * 0.3, R * 0.84, side * R * 0.3],
        s: [1, 0.3, 1],
      })),
      // Нижняя челюсть: сдвинута и лежит ниже, и это то, что отличает
      // лежащий череп от камня с двумя дырками.
      P(boxGeo(R * 0.86, R * 0.14, R * 0.62), c.boneDark, {
        t: [R * 0.42, R * 0.1, 0], r: [0, 0.1, 0.08],
      }),
    ];
    return out;
  },

  // Рёбра: дуги, расходящиеся от позвоночника, лежат веером, видны
  // просветы между рёбрами. Просветы и есть силуэт.
  ribs: (p, c) => {
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      const t = i / 4;
      const y = p.h * (0.2 + t * 0.55);
      const spread = p.r * (0.9 - Math.abs(t - 0.4) * 0.5);
      out.push(P(tube(
        [
          [-spread, y, t * p.r * 0.3],
          [-spread * 0.4, y + p.h * 0.28, t * p.r * 0.3 - p.r * 0.1],
          [spread * 0.4, y + p.h * 0.28, t * p.r * 0.3 - p.r * 0.1],
          [spread, y, t * p.r * 0.3],
        ],
        [p.r * 0.045, p.r * 0.055, p.r * 0.055, p.r * 0.045],
        4,
      ), c.bone));
    }
    // Позвоночник вдоль веера: без него дуги висят в воздухе и читаются
    // как проволока.
    out.push(P(tube(
      [[0, p.h * 0.16, -p.r * 0.1], [p.r * 0.1, p.h * 0.5, p.r * 0.05], [0, p.h * 0.78, p.r * 0.2]],
      [p.r * 0.09, p.r * 0.08, p.r * 0.06],
      5,
    ), c.boneDark));
    return out;
  },

  // Позвоночник: цепочка позвонков с отростками, изогнутая. Самая плоская
  // модель набора.
  spine: (p, c) => {
    const out = [];
    const segs = 8;
    for (let i = 0; i < segs; i += 1) {
      const t = i / (segs - 1);
      const x = p.r * (-1 + t * 2);
      const y = p.h * 0.5 + Math.sin(t * Math.PI) * p.h * 0.4;
      out.push(P(boxGeo(p.r * 0.26, p.r * 0.12, p.r * 0.18), c.bone, {
        t: [x, y, 0], r: [0, 0, -Math.sin(t * Math.PI) * 0.5],
      }));
      // Отростки вверх: у позвоночника они и дают «зубчатый» контур, без
      // него цепочка читается как шнур.
      out.push(P(boxGeo(p.r * 0.06, p.r * 0.22, p.r * 0.06), c.boneDark, {
        t: [x, y + p.r * 0.14, 0], r: [0, 0, -Math.sin(t * Math.PI) * 0.5 - 0.3],
      }));
    }
    return out;
  },

  // Скелет целиком: собран в позу, одна рука отдельно лежит рядом. Лежит
  // на боку, поэтому читается по контуру скелета, а не по позе.
  skeleton: (p, c) => {
    const out = [];
    out.push(P(lumpGeo(p.r * 0.3, 0, 291), c.bone, { t: [-p.r * 0.55, p.h * 0.5, 0], s: [1.2, 0.9, 1] }));
    out.push(P(lumpGeo(p.r * 0.16, 0, 292), c.bone, {
      t: [-p.r * 0.2, p.h * 0.5, 0], s: [1.4, 0.8, 0.9],
    }));
    for (const side of [-1, 1]) {
      out.push(P(octa(p.r * 0.08), c.hollow, {
        t: [-p.r * 0.28, p.h * 0.55, side * p.r * 0.1], s: [1, 1, 0.5],
      }));
    }
    // Позвоночник и таз: две линии, дающие ось тела.
    out.push(P(tube(
      [[-p.r * 0.05, p.h * 0.45, 0], [p.r * 0.25, p.h * 0.48, 0], [p.r * 0.55, p.h * 0.45, 0]],
      [p.r * 0.06, p.r * 0.05, p.r * 0.06],
      4,
    ), c.boneDark));
    out.push(P(octa(p.r * 0.16), c.bone, { t: [p.r * 0.7, p.h * 0.44, 0], s: [1.5, 0.7, 1.2] }));
    // Рёбра: две дуги, уложенные в ту же высоту, что и таз. Третья дуга стоила
    // бы двадцати треугольников из двухсот, а на 11 пикселях её не видно.
    for (let i = 0; i < 2; i += 1) {
      const x = p.r * (0.12 + i * 0.18);
      out.push(P(tube(
        [
          [x, p.h * 0.52, -p.r * 0.2],
          [x, p.h * 0.62, 0],
          [x, p.h * 0.52, p.r * 0.2],
        ],
        [p.r * 0.04, p.r * 0.045, p.r * 0.04],
        4,
      ), c.bone));
    }
    // Ноги согнуты: согнутая нога читается позой, прямая — палкой.
    for (const side of [-1, 1]) {
      out.push(P(tube(
        [
          [p.r * 0.72, p.h * 0.42, side * p.r * 0.12],
          [p.r * 0.95, p.h * 0.22, side * p.r * 0.18],
          [p.r * 0.8, p.h * 0.05, side * p.r * 0.22],
        ],
        [p.r * 0.07, p.r * 0.06, p.r * 0.05],
        4,
      ), c.boneDark));
    }
    // Одна рука приподнята, вторая лежит отдельно — это и есть поза.
    out.push(P(tube(
      [
        [p.r * 0.3, p.h * 0.5, p.r * 0.18],
        [p.r * 0.05, p.h * 0.75, p.r * 0.3],
        [-p.r * 0.2, p.h * 0.85, p.r * 0.2],
      ],
      [p.r * 0.05, p.r * 0.045, p.r * 0.035],
      4,
    ), c.bone));
    out.push(P(tube(
      [[p.r * 0.35, p.h * 0.08, p.r * 0.42], [p.r * 0.75, p.h * 0.06, p.r * 0.5]],
      [p.r * 0.05, p.r * 0.035],
      4,
    ), c.bone));
    return out;
  },
};

// Кольцо для венца колодца: труба с круговым сечением. Отдельный примитив
// не ради формы, а ради читаемости — венец держит верх колодца.
const torusRing = (radius, tubeR, seg) => {
  const points = [], radii = [];
  for (let i = 0; i <= seg; i += 1) {
    const a = ((i % seg) / seg) * TAU;
    points.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
    radii.push(tubeR);
  }
  return tube(points, radii, 4, { capStart: false, capEnd: false });
};

// ---------- реестр слотов ----------

/* Реестр — зеркало таблицы из docs/CONTRACT.md плюс полосы размеров из
   задания по слотам. Номера не переставляются и не добавляются: номер это
   контракт с игрой. Полосы размеров лежат здесь, а не в форме, потому что
   полоса — это обещание карте: она одна для всех наборов, и набор меняет
   форму, но не обещание. */
export const SLOTS = [
  { n: 1, name: 'сосна высокая', form: 'pine', kind: 'tree', footprint: 1, solid: true, h: [6.5, 7.0], r: [1.0, 1.2] },
  { n: 2, name: 'ель', form: 'spruce', kind: 'tree', footprint: 1, solid: true, h: [6.0, 6.8], r: [1.1, 1.3] },
  { n: 3, name: 'лиственное широкое', form: 'broadleaf', kind: 'tree', footprint: 1, solid: true, h: [5.0, 5.8], r: [1.4, 1.6] },
  { n: 4, name: 'берёза', form: 'birch', kind: 'tree', footprint: 1, solid: true, h: [6.0, 6.6], r: [0.8, 1.0] },
  { n: 5, name: 'тополь', form: 'poplar', kind: 'tree', footprint: 1, solid: true, h: [6.5, 7.0], r: [0.9, 1.1] },
  { n: 6, name: 'ореш', form: 'hazel', kind: 'tree', footprint: 1, solid: true, h: [4.6, 5.2], r: [1.3, 1.5] },
  { n: 7, name: 'сухостой', form: 'deadwood', kind: 'tree', footprint: 1, solid: true, h: [5.2, 6.0], r: [1.0, 1.2] },
  { n: 8, name: 'старое кривое дерево', form: 'oldTree', kind: 'tree', footprint: 1, solid: true, h: [5.4, 6.2], r: [1.3, 1.6] },
  { n: 9, name: 'молодое деревце', form: 'sapling', kind: 'tree', footprint: 1, solid: true, h: [3.0, 3.6], r: [0.7, 0.9] },
  { n: 10, name: 'наклонённое дерево', form: 'leaningTree', kind: 'tree', footprint: 1, solid: true, h: [5.6, 6.4], r: [1.2, 1.4] },

  { n: 11, name: 'куст', form: 'bush', kind: 'bush', footprint: 1, solid: false, h: [1.1, 1.5], r: [0.7, 0.9] },
  { n: 12, name: 'ежевичник', form: 'bramble', kind: 'bush', footprint: 1, solid: false, h: [0.8, 1.1], r: [1.0, 1.2] },
  { n: 13, name: 'цветущий куст', form: 'floweringBush', kind: 'bush', footprint: 1, solid: false, h: [1.0, 1.3], r: [0.7, 0.9] },
  { n: 14, name: 'низкий ползучий куст', form: 'creeper', kind: 'bush', footprint: 1, solid: false, h: [0.5, 0.8], r: [1.1, 1.4] },
  { n: 15, name: 'кочка травы', form: 'grassTuft', kind: 'bush', footprint: 1, solid: false, h: [0.6, 0.9], r: [0.6, 0.8] },
  { n: 16, name: 'папоротник', form: 'fern', kind: 'bush', footprint: 1, solid: false, h: [0.8, 1.1], r: [0.8, 1.0] },

  { n: 17, name: 'камень мелкий', form: 'smallRock', kind: 'rock', footprint: 1, solid: true, h: [0.6, 0.9], r: [0.4, 0.6] },
  { n: 18, name: 'камень средний', form: 'mediumRock', kind: 'rock', footprint: 1, solid: true, h: [1.2, 1.6], r: [0.7, 0.9] },
  { n: 19, name: 'валун', form: 'boulder', kind: 'rock', footprint: 2, solid: true, h: [1.8, 2.4], r: [1.0, 1.4] },
  { n: 20, name: 'скальная гряда', form: 'cragRidge', kind: 'rock', footprint: 2, solid: true, h: [1.6, 2.2], r: [1.2, 1.6] },
  { n: 21, name: 'плита', form: 'slab', kind: 'rock', footprint: 1, solid: true, h: [0.8, 1.2], r: [1.0, 1.4] },
  { n: 22, name: 'сланцевый блок, плоский', form: 'slateStack', kind: 'rock', footprint: 1, solid: true, h: [0.6, 0.9], r: [0.8, 1.2] },
  { n: 23, name: 'камень в моху', form: 'mossyRock', kind: 'rock', footprint: 1, solid: true, h: [0.9, 1.3], r: [0.6, 0.8] },
  { n: 24, name: 'россыпь мелких камней', form: 'pebbles', kind: 'rock', footprint: 2, solid: true, h: [0.4, 0.7], r: [1.0, 1.5] },

  { n: 25, name: 'поваленное дерево', form: 'fallenTree', kind: 'debris', footprint: 2, solid: true, h: [0.7, 1.0], r: [1.4, 1.8] },
  { n: 26, name: 'пень', form: 'stump', kind: 'debris', footprint: 1, solid: true, h: [0.6, 0.9], r: [0.6, 0.8] },
  { n: 27, name: 'сломанная ветка', form: 'brokenBranch', kind: 'debris', footprint: 1, solid: true, h: [0.3, 0.5], r: [1.0, 1.4] },
  { n: 28, name: 'корневая плита', form: 'rootPlate', kind: 'debris', footprint: 2, solid: true, h: [0.8, 1.2], r: [1.2, 1.6] },
  { n: 29, name: 'доски', form: 'planks', kind: 'debris', footprint: 2, solid: true, h: [0.3, 0.5], r: [1.2, 1.5] },
  { n: 30, name: 'хворост', form: 'twigs', kind: 'debris', footprint: 1, solid: true, h: [0.4, 0.6], r: [0.9, 1.2] },

  { n: 31, name: 'колонна', form: 'column', kind: 'ruin', footprint: 1, solid: true, h: [3.2, 4.0], r: [0.6, 0.8] },
  { n: 32, name: 'арка', form: 'arch', kind: 'ruin', footprint: 2, solid: true, h: [2.6, 3.4], r: [1.3, 1.6] },
  { n: 33, name: 'стена', form: 'wall', kind: 'ruin', footprint: 2, solid: true, h: [2.4, 3.0], r: [1.4, 1.8] },
  { n: 34, name: 'ступени', form: 'steps', kind: 'ruin', footprint: 2, solid: true, h: [1.4, 1.8], r: [1.2, 1.6] },
  { n: 35, name: 'алтарь', form: 'altar', kind: 'ruin', footprint: 1, solid: true, h: [1.6, 2.0], r: [0.8, 1.0] },
  { n: 36, name: 'колодец', form: 'well', kind: 'ruin', footprint: 1, solid: true, h: [1.2, 1.6], r: [0.9, 1.1] },

  { n: 37, name: 'череп', form: 'skull', kind: 'bone', footprint: 1, solid: false, h: [0.45, 0.6], r: [0.4, 0.5] },
  { n: 38, name: 'рёбра', form: 'ribs', kind: 'bone', footprint: 1, solid: false, h: [0.4, 0.6], r: [0.6, 0.8] },
  { n: 39, name: 'позвоночник', form: 'spine', kind: 'bone', footprint: 1, solid: false, h: [0.25, 0.35], r: [0.9, 1.2] },
  { n: 40, name: 'скелет целиком', form: 'skeleton', kind: 'bone', footprint: 2, solid: false, h: [0.5, 0.7], r: [1.0, 1.3] },
];

export {
  cross, unit, noise, geo, tri, quad, part, P, xform, recalc,
  cyl, boxGeo, tube, orb, icosa, octa,
  trunkGeo, branchGeo, tierGeo, spray, bladeGeo, lumpGeo, spikeGeo,
  FORMS, torusRing,
};