/**
 * The DECODE table: what a fuel pixel IS, for display and attribution. #282 task 3.
 *
 * NOT YET WIRED, AND THAT IS THE CORRECT STATE. No production file outside this
 * directory imports this module: every reference today is in its own test. #282 is
 * what connects it, and #282 is parked upstream on NFIS declaring a NoData value.
 * Nothing in the application decodes a fuel pixel for display yet.
 *
 * DELETE THIS PARAGRAPH WHEN #282 WIRES IT UP. It is not decoration:
 * scripts/__tests__/fuel_modules_declare_wiring.test.sh fails on a module that has
 * acquired a production importer while still claiming to be unwired, so the note
 * cannot quietly outlive the condition it describes (#523).
 * NOT FireSTARR'S MODELLING TABLE, and the difference is deliberate on both
 * sides. FireSTARR's own `fuel.lut` gives the non-fuel block burnable fuel types
 * so that non-fuel behaves as a very slow fuel and some movement occurs
 * (BadgerOnABike, #282, 2026-11-03). Correct for MODELLING. Wrong for telling
 * anyone what a pixel is: it would decode vegetated non-fuel as burnable
 * mixedwood, and `101` and `105` both occur in live coverage windows.
 *
 * EMBEDDED, NOT READ FROM DISK. `copy:assets` copies only
 * `src/services/splash/assets`, so a `.csv` in this directory would load during
 * tests and be absent from `dist` - a green suite over a broken container. The
 * `.csv` beside this file is kept as provenance, and a test asserts this string
 * is exactly that file, so the two cannot drift.
 *
 * SOURCE: `fuel_updated.csv`, attached by BadgerOnABike to
 * WISE-Developers/project_nomad#282 on 2026-11-03. Regenerate this constant from
 * that file if CFS issues a new table; do not hand-edit one copy.
 */

import { parseFuelLut, type FuelLut } from './fuelGridLut';

/**
 * The six rows that separate the decode table from the modelling table. Derived
 * by diffing the two real files rather than chosen: these are exactly the rows
 * that change, and naming one of them (as I first did with 105 alone) names a
 * member of a class instead of the class.
 */
export const NON_FUEL_GRID_VALUES = [100, 101, 103, 104, 105, 106] as const;

/** The canonical decode table, verbatim. */
export const DECODE_LUT_CSV = `grid_value, export_value, descriptive_name, fuel_type, r, g, b, h, s, l
1,1,Spruce-Lichen Woodland,C-1,209,255,115,57,255,185
2,2,Boreal Spruce,C-2,34,102,51,95,128,68
3,3,Mature Jack or Lodgepole Pine,C-3,131,199,149,96,96,165
4,4,Immature Jack or Lodgepole Pine,C-4,112,168,0,57,255,84
5,5,Red and White Pine,C-5,223,184,230,206,122,207
6,6,Conifer Plantation,C-6,172,102,237,192,201,170
7,7,Ponderosa Pine - Douglas-Fir,C-7,112,12,242,188,231,127
11,11,Leafless Aspen,D-1,196,189,151,35,70,174
12,12,Green Aspen (with BUI Thresholding),D-2,137,112,68,27,86,103
13,13,Aspen,D-1/D-2,196,189,151,35,70,174
21,21,Jack or Lodgepole Pine Slash,S-1,251,190,185,3,227,218
22,22,White Spruce - Balsam Slash,S-2,247,104,161,-272,229,176
23,23,Coastal Cedar - Hemlock - Douglas-Fir Slash,S-3,174,1,126,-285,252,88
31,31,Matted Grass,O-1a,255,255,190,42,255,223
32,32,Standing Grass,O-1b,230,230,0,42,255,115
33,33,Grass,O-1,230,230,0,42,255,115
40,40,Boreal Mixedwood - Leafless,M-1,255,211,127,28,255,191
50,50,Boreal Mixedwood - Green,M-2,255,170,0,28,255,128
60,60,Boreal Mixedwood,M-1/M-2,255,211,127,28,255,191
70,70,Dead Balsam Fir Mixedwood - Leafless,M-3,99,0,0,0,255,50
80,80,Dead Balsam Fir Mixedwood - Green,M-4,170,0,0,0,255,85
90,90,Dead Balsam Fir Mixedwood,M-3/M-4,99,0,0,0,255,50
100,100,Not Available,Non-fuel,255,255,255,170,0,255
101,101,Non-fuel,Non-fuel,130,130,130,170,0,130
102,102,Water,Non-fuel,115,223,255,138,255,185
103,103,Unknown,Non-fuel,0,0,0,170,0,0
104,104,Unclassified,Non-fuel,166,166,166,170,0,166
105,105,Vegetated Non-Fuel,Non-fuel,204,204,204,170,0,204
106,106,Urban,Non-fuel,166,166,166,170,0,166
400,400,Boreal Mixedwood - Leafless (00% Conifer),M-1 (00 PC),255,211,127,28,255,191
405,405,Boreal Mixedwood - Leafless (05% Conifer),M-1 (05 PC),255,211,127,28,255,191
410,410,Boreal Mixedwood - Leafless (10% Conifer),M-1 (10 PC),255,211,127,28,255,191
415,415,Boreal Mixedwood - Leafless (15% Conifer),M-1 (15 PC),255,211,127,28,255,191
420,420,Boreal Mixedwood - Leafless (20% Conifer),M-1 (20 PC),255,211,127,28,255,191
425,425,Boreal Mixedwood - Leafless (25% Conifer),M-1 (25 PC),255,211,127,28,255,191
430,430,Boreal Mixedwood - Leafless (30% Conifer),M-1 (30 PC),255,211,127,28,255,191
435,435,Boreal Mixedwood - Leafless (35% Conifer),M-1 (35 PC),255,211,127,28,255,191
440,440,Boreal Mixedwood - Leafless (40% Conifer),M-1 (40 PC),255,211,127,28,255,191
445,445,Boreal Mixedwood - Leafless (45% Conifer),M-1 (45 PC),255,211,127,28,255,191
450,450,Boreal Mixedwood - Leafless (50% Conifer),M-1 (50 PC),255,211,127,28,255,191
455,455,Boreal Mixedwood - Leafless (55% Conifer),M-1 (55 PC),255,211,127,28,255,191
460,460,Boreal Mixedwood - Leafless (60% Conifer),M-1 (60 PC),255,211,127,28,255,191
465,465,Boreal Mixedwood - Leafless (65% Conifer),M-1 (65 PC),255,211,127,28,255,191
470,470,Boreal Mixedwood - Leafless (70% Conifer),M-1 (70 PC),255,211,127,28,255,191
475,475,Boreal Mixedwood - Leafless (75% Conifer),M-1 (75 PC),255,211,127,28,255,191
480,480,Boreal Mixedwood - Leafless (80% Conifer),M-1 (80 PC),255,211,127,28,255,191
485,485,Boreal Mixedwood - Leafless (85% Conifer),M-1 (85 PC),255,211,127,28,255,191
490,490,Boreal Mixedwood - Leafless (90% Conifer),M-1 (90 PC),255,211,127,28,255,191
495,495,Boreal Mixedwood - Leafless (95% Conifer),M-1 (95 PC),255,211,127,28,255,191
500,500,Boreal Mixedwood - Green (00% Conifer),M-2 (00 PC),255,170,0,28,255,128
505,505,Boreal Mixedwood - Green (05% Conifer),M-2 (05 PC),255,170,0,28,255,128
510,510,Boreal Mixedwood - Green (10% Conifer),M-2 (10 PC),255,170,0,28,255,128
515,515,Boreal Mixedwood - Green (15% Conifer),M-2 (15 PC),255,170,0,28,255,128
520,520,Boreal Mixedwood - Green (20% Conifer),M-2 (20 PC),255,170,0,28,255,128
525,525,Boreal Mixedwood - Green (25% Conifer),M-2 (25 PC),255,170,0,28,255,128
530,530,Boreal Mixedwood - Green (30% Conifer),M-2 (30 PC),255,170,0,28,255,128
535,535,Boreal Mixedwood - Green (35% Conifer),M-2 (35 PC),255,170,0,28,255,128
540,540,Boreal Mixedwood - Green (40% Conifer),M-2 (40 PC),255,170,0,28,255,128
545,545,Boreal Mixedwood - Green (45% Conifer),M-2 (45 PC),255,170,0,28,255,128
550,550,Boreal Mixedwood - Green (50% Conifer),M-2 (50 PC),255,170,0,28,255,128
555,555,Boreal Mixedwood - Green (55% Conifer),M-2 (55 PC),255,170,0,28,255,128
560,560,Boreal Mixedwood - Green (60% Conifer),M-2 (60 PC),255,170,0,28,255,128
565,565,Boreal Mixedwood - Green (65% Conifer),M-2 (65 PC),255,170,0,28,255,128
570,570,Boreal Mixedwood - Green (70% Conifer),M-2 (70 PC),255,170,0,28,255,128
575,575,Boreal Mixedwood - Green (75% Conifer),M-2 (75 PC),255,170,0,28,255,128
580,580,Boreal Mixedwood - Green (80% Conifer),M-2 (80 PC),255,170,0,28,255,128
585,585,Boreal Mixedwood - Green (85% Conifer),M-2 (85 PC),255,170,0,28,255,128
590,590,Boreal Mixedwood - Green (90% Conifer),M-2 (90 PC),255,170,0,28,255,128
595,595,Boreal Mixedwood - Green (95% Conifer),M-2 (95 PC),255,170,0,28,255,128
600,600,Boreal Mixedwood (00% Conifer),M-1/M-2 (00 PC),255,211,127,28,255,191
605,605,Boreal Mixedwood (05% Conifer),M-1/M-2 (05 PC),255,211,127,28,255,191
610,610,Boreal Mixedwood (10% Conifer),M-1/M-2 (10 PC),255,211,127,28,255,191
615,615,Boreal Mixedwood (15% Conifer),M-1/M-2 (15 PC),255,211,127,28,255,191
620,620,Boreal Mixedwood (20% Conifer),M-1/M-2 (20 PC),255,211,127,28,255,191
625,625,Boreal Mixedwood (25% Conifer),M-1/M-2 (25 PC),255,211,127,28,255,191
630,630,Boreal Mixedwood (30% Conifer),M-1/M-2 (30 PC),255,211,127,28,255,191
635,635,Boreal Mixedwood (35% Conifer),M-1/M-2 (35 PC),255,211,127,28,255,191
640,640,Boreal Mixedwood (40% Conifer),M-1/M-2 (40 PC),255,211,127,28,255,191
645,645,Boreal Mixedwood (45% Conifer),M-1/M-2 (45 PC),255,211,127,28,255,191
650,650,Boreal Mixedwood (50% Conifer),M-1/M-2 (50 PC),255,211,127,28,255,191
655,655,Boreal Mixedwood (55% Conifer),M-1/M-2 (55 PC),255,211,127,28,255,191
660,660,Boreal Mixedwood (60% Conifer),M-1/M-2 (60 PC),255,211,127,28,255,191
665,665,Boreal Mixedwood (65% Conifer),M-1/M-2 (65 PC),255,211,127,28,255,191
670,670,Boreal Mixedwood (70% Conifer),M-1/M-2 (70 PC),255,211,127,28,255,191
675,675,Boreal Mixedwood (75% Conifer),M-1/M-2 (75 PC),255,211,127,28,255,191
680,680,Boreal Mixedwood (80% Conifer),M-1/M-2 (80 PC),255,211,127,28,255,191
685,685,Boreal Mixedwood (85% Conifer),M-1/M-2 (85 PC),255,211,127,28,255,191
690,690,Boreal Mixedwood (90% Conifer),M-1/M-2 (90 PC),255,211,127,28,255,191
695,695,Boreal Mixedwood (95% Conifer),M-1/M-2 (95 PC),255,211,127,28,255,191
700,700,Dead Balsam Fir Mixedwood - Leafless (00% Dead Fir),M-3 (00 PDF),99,0,0,0,255,50
705,705,Dead Balsam Fir Mixedwood - Leafless (05% Dead Fir),M-3 (05 PDF),99,0,0,0,255,50
710,710,Dead Balsam Fir Mixedwood - Leafless (10% Dead Fir),M-3 (10 PDF),99,0,0,0,255,50
715,715,Dead Balsam Fir Mixedwood - Leafless (15% Dead Fir),M-3 (15 PDF),99,0,0,0,255,50
720,720,Dead Balsam Fir Mixedwood - Leafless (20% Dead Fir),M-3 (20 PDF),99,0,0,0,255,50
725,725,Dead Balsam Fir Mixedwood - Leafless (25% Dead Fir),M-3 (25 PDF),99,0,0,0,255,50
730,730,Dead Balsam Fir Mixedwood - Leafless (30% Dead Fir),M-3 (30 PDF),99,0,0,0,255,50
735,735,Dead Balsam Fir Mixedwood - Leafless (35% Dead Fir),M-3 (35 PDF),99,0,0,0,255,50
740,740,Dead Balsam Fir Mixedwood - Leafless (40% Dead Fir),M-3 (40 PDF),99,0,0,0,255,50
745,745,Dead Balsam Fir Mixedwood - Leafless (45% Dead Fir),M-3 (45 PDF),99,0,0,0,255,50
750,750,Dead Balsam Fir Mixedwood - Leafless (50% Dead Fir),M-3 (50 PDF),99,0,0,0,255,50
755,755,Dead Balsam Fir Mixedwood - Leafless (55% Dead Fir),M-3 (55 PDF),99,0,0,0,255,50
760,760,Dead Balsam Fir Mixedwood - Leafless (60% Dead Fir),M-3 (60 PDF),99,0,0,0,255,50
765,765,Dead Balsam Fir Mixedwood - Leafless (65% Dead Fir),M-3 (65 PDF),99,0,0,0,255,50
770,770,Dead Balsam Fir Mixedwood - Leafless (70% Dead Fir),M-3 (70 PDF),99,0,0,0,255,50
775,775,Dead Balsam Fir Mixedwood - Leafless (75% Dead Fir),M-3 (75 PDF),99,0,0,0,255,50
780,780,Dead Balsam Fir Mixedwood - Leafless (80% Dead Fir),M-3 (80 PDF),99,0,0,0,255,50
785,785,Dead Balsam Fir Mixedwood - Leafless (85% Dead Fir),M-3 (85 PDF),99,0,0,0,255,50
790,790,Dead Balsam Fir Mixedwood - Leafless (90% Dead Fir),M-3 (90 PDF),99,0,0,0,255,50
795,795,Dead Balsam Fir Mixedwood - Leafless (95% Dead Fir),M-3 (95 PDF),99,0,0,0,255,50
800,800,Dead Balsam Fir Mixedwood - Green (00% Dead Fir),M-4 (00 PDF),170,0,0,0,255,85
805,805,Dead Balsam Fir Mixedwood - Green (05% Dead Fir),M-4 (05 PDF),170,0,0,0,255,85
810,810,Dead Balsam Fir Mixedwood - Green (10% Dead Fir),M-4 (10 PDF),170,0,0,0,255,85
815,815,Dead Balsam Fir Mixedwood - Green (15% Dead Fir),M-4 (15 PDF),170,0,0,0,255,85
820,820,Dead Balsam Fir Mixedwood - Green (20% Dead Fir),M-4 (20 PDF),170,0,0,0,255,85
825,825,Dead Balsam Fir Mixedwood - Green (25% Dead Fir),M-4 (25 PDF),170,0,0,0,255,85
830,830,Dead Balsam Fir Mixedwood - Green (30% Dead Fir),M-4 (30 PDF),170,0,0,0,255,85
835,835,Dead Balsam Fir Mixedwood - Green (35% Dead Fir),M-4 (35 PDF),170,0,0,0,255,85
840,840,Dead Balsam Fir Mixedwood - Green (40% Dead Fir),M-4 (40 PDF),170,0,0,0,255,85
845,845,Dead Balsam Fir Mixedwood - Green (45% Dead Fir),M-4 (45 PDF),170,0,0,0,255,85
850,850,Dead Balsam Fir Mixedwood - Green (50% Dead Fir),M-4 (50 PDF),170,0,0,0,255,85
855,855,Dead Balsam Fir Mixedwood - Green (55% Dead Fir),M-4 (55 PDF),170,0,0,0,255,85
860,860,Dead Balsam Fir Mixedwood - Green (60% Dead Fir),M-4 (60 PDF),170,0,0,0,255,85
865,865,Dead Balsam Fir Mixedwood - Green (65% Dead Fir),M-4 (65 PDF),170,0,0,0,255,85
870,870,Dead Balsam Fir Mixedwood - Green (70% Dead Fir),M-4 (70 PDF),170,0,0,0,255,85
875,875,Dead Balsam Fir Mixedwood - Green (75% Dead Fir),M-4 (75 PDF),170,0,0,0,255,85
880,880,Dead Balsam Fir Mixedwood - Green (80% Dead Fir),M-4 (80 PDF),170,0,0,0,255,85
885,885,Dead Balsam Fir Mixedwood - Green (85% Dead Fir),M-4 (85 PDF),170,0,0,0,255,85
890,890,Dead Balsam Fir Mixedwood - Green (90% Dead Fir),M-4 (90 PDF),170,0,0,0,255,85
895,895,Dead Balsam Fir Mixedwood - Green (95% Dead Fir),M-4 (95 PDF),170,0,0,0,255,85
900,900,Dead Balsam Fir Mixedwood (00% Dead Fir),M-3/M-4 (00 PDF),99,0,0,0,255,50
905,905,Dead Balsam Fir Mixedwood (05% Dead Fir),M-3/M-4 (05 PDF),99,0,0,0,255,50
910,910,Dead Balsam Fir Mixedwood (10% Dead Fir),M-3/M-4 (10 PDF),99,0,0,0,255,50
915,915,Dead Balsam Fir Mixedwood (15% Dead Fir),M-3/M-4 (15 PDF),99,0,0,0,255,50
920,920,Dead Balsam Fir Mixedwood (20% Dead Fir),M-3/M-4 (20 PDF),99,0,0,0,255,50
925,925,Dead Balsam Fir Mixedwood (25% Dead Fir),M-3/M-4 (25 PDF),99,0,0,0,255,50
930,930,Dead Balsam Fir Mixedwood (30% Dead Fir),M-3/M-4 (30 PDF),99,0,0,0,255,50
935,935,Dead Balsam Fir Mixedwood (35% Dead Fir),M-3/M-4 (35 PDF),99,0,0,0,255,50
940,940,Dead Balsam Fir Mixedwood (40% Dead Fir),M-3/M-4 (40 PDF),99,0,0,0,255,50
945,945,Dead Balsam Fir Mixedwood (45% Dead Fir),M-3/M-4 (45 PDF),99,0,0,0,255,50
950,950,Dead Balsam Fir Mixedwood (50% Dead Fir),M-3/M-4 (50 PDF),99,0,0,0,255,50
955,955,Dead Balsam Fir Mixedwood (55% Dead Fir),M-3/M-4 (55 PDF),99,0,0,0,255,50
960,960,Dead Balsam Fir Mixedwood (60% Dead Fir),M-3/M-4 (60 PDF),99,0,0,0,255,50
965,965,Dead Balsam Fir Mixedwood (65% Dead Fir),M-3/M-4 (65 PDF),99,0,0,0,255,50
970,970,Dead Balsam Fir Mixedwood (70% Dead Fir),M-3/M-4 (70 PDF),99,0,0,0,255,50
975,975,Dead Balsam Fir Mixedwood (75% Dead Fir),M-3/M-4 (75 PDF),99,0,0,0,255,50
980,980,Dead Balsam Fir Mixedwood (80% Dead Fir),M-3/M-4 (80 PDF),99,0,0,0,255,50
985,985,Dead Balsam Fir Mixedwood (85% Dead Fir),M-3/M-4 (85 PDF),99,0,0,0,255,50
990,990,Dead Balsam Fir Mixedwood (90% Dead Fir),M-3/M-4 (90 PDF),99,0,0,0,255,50
995,995,Dead Balsam Fir Mixedwood (95% Dead Fir),M-3/M-4 (95 PDF),99,0,0,0,255,50`;

/**
 * A decode table, distinguished from a bare `FuelLut` at the type level so a
 * modelling table cannot be passed where decoding is expected. The runtime
 * check in `assertDecodeTable` is what actually earns the brand.
 */
export type DecodeFuelLut = FuelLut & { readonly __decodeTable: unique symbol };

/**
 * Fails when handed a table whose non-fuel rows carry burnable fuel types -
 * i.e. FireSTARR's modelling table, or a truncated table missing those rows.
 * Reports every offending row, because a message naming one invites fixing one.
 */
export function assertDecodeTable(lut: FuelLut): void {
  const offenders: string[] = [];
  for (const gridValue of NON_FUEL_GRID_VALUES) {
    const row = lut.get(gridValue);
    if (!row) {
      offenders.push(`${gridValue}: missing`);
      continue;
    }
    if (row.fuelType !== 'Non-fuel') {
      offenders.push(`${gridValue}: fuel_type=${row.fuelType}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      'this is not a decode table - it looks like FireSTARR\'s modelling table, which gives ' +
        'the non-fuel block burnable fuel types on purpose. Decoding with it would report ' +
        `non-fuel as burnable. Offending rows: ${offenders.join('; ')}`,
    );
  }
}

let cached: DecodeFuelLut | undefined;

/**
 * The decode table, parsed and CHECKED before it is handed out.
 *
 * `csv` is a parameter purely so the check is observable. With the shipped
 * table hardwired, deleting the `assertDecodeTable` call below changed no test
 * result at all - the embedded table is valid, so the guard never fired and its
 * absence was invisible. Passing a modelling table in is the only way to prove
 * the load path actually validates. Callers should use the default.
 */
export function loadDecodeFuelLut(csv: string = DECODE_LUT_CSV): DecodeFuelLut {
  const isDefault = csv === DECODE_LUT_CSV;
  if (isDefault && cached) return cached;
  const lut = parseFuelLut(csv);
  assertDecodeTable(lut);
  if (isDefault) cached = lut as DecodeFuelLut;
  return lut as DecodeFuelLut;
}
