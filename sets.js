/* NexusModeler — наборы.
 *
 * Набор отвечает на один вопрос: какая форма и какие числа стоят в каждом
 * из сорока слотов. Слот — это место, поэтому набор меняет числа и форму, но
 * не номера и не `kind`.
 *
 * Палитра здесь, а не в формах: формы не знают ни про лес, ни про пустыню,
 * они знают про `bark`, `needle` и `rock`. Цвет сету принадлежит, и он же
 * переедет в другой набор вместе с формой.
 */

const forest = {
  id: 'forest',
  name: 'Лес-Поле',
  // Тон и светлота — часть читаемости, а не украшение. Палитра подобрана так,
  // чтобы каждая группа читалась светлотой на тёмно-зелёной земле: контракт
  // требует, чтобы мелкое читалось силуэтом и светлотой, а тёмная хвоя на
  // тёмной земле даёт чёрное пятно, которое не сказа�� ничего.
  palette: {
    bark: 0x6b5540,
    barkLight: 0xe0dac8,
    barkDark: 0x4a3b2c,
    dead: 0x6e6355,
    deadDark: 0x453d33,
    needle: 0x4e7442,
    needleDark: 0x4a6b3f,
    leaf: 0x5c8442,
    leafDark: 0x5a7c46,
    leafLight: 0x86a45c,
    flower: 0xe4d474,
    rock: 0x8a877e,
    rockLight: 0xaaa69a,
    rockDark: 0x615f58,
    slate: 0x74757e,
    slateLight: 0x92939c,
    moss: 0x5b7d45,
    soil: 0x5c4834,
    wood: 0x87694a,
    woodDark: 0x634f36,
    stone: 0x9c9484,
    stoneLight: 0xb8b0a2,
    stoneDark: 0x7a7367,
    rubble: 0x968d7d,
    hollow: 0x141210,
    bone: 0xd8d0ba,
    boneDark: 0xa8a089,
  },
  // Что стоит в каждом из сорока слотов. Ключ — номер слота, и набор обязан
  // перечислить все сорок: пропуск — дыра на карте, и проверка полноты
  // падает на нём.
  //
  // Форма здесь совпадает с реестром, но это не совпадение по недосмотру:
  // именно смена формы на том же номере и есть «слот — обещание вида». В
  // пустыне на слоте 7 встанет кактус, и карта останется читаемой, потому
  // что номер значит место, а не картинку.
  forms: {
    1: { form: 'pine' },
    2: { form: 'spruce' },
    3: { form: 'broadleaf' },
    4: { form: 'birch' },
    5: { form: 'poplar' },
    6: { form: 'hazel' },
    7: { form: 'deadwood' },
    8: { form: 'oldTree', r: 1.5 },
    9: { form: 'sapling' },
    10: { form: 'leaningTree' },
    11: { form: 'bush' },
    12: { form: 'bramble' },
    13: { form: 'floweringBush' },
    14: { form: 'creeper' },
    15: { form: 'grassTuft' },
    16: { form: 'fern' },
    17: { form: 'smallRock' },
    18: { form: 'mediumRock' },
    19: { form: 'boulder' },
    20: { form: 'cragRidge' },
    21: { form: 'slab' },
    22: { form: 'slateStack' },
    23: { form: 'mossyRock' },
    24: { form: 'pebbles' },
    25: { form: 'fallenTree' },
    26: { form: 'stump' },
    27: { form: 'brokenBranch' },
    28: { form: 'rootPlate' },
    29: { form: 'planks' },
    30: { form: 'twigs' },
    31: { form: 'column' },
    32: { form: 'arch' },
    33: { form: 'wall' },
    34: { form: 'steps' },
    35: { form: 'altar' },
    36: { form: 'well' },
    37: { form: 'skull' },
    38: { form: 'ribs' },
    39: { form: 'spine' },
    40: { form: 'skeleton' },
  },
};

export const SETS = { forest };

export const setById = (id) => SETS[id] ?? null;