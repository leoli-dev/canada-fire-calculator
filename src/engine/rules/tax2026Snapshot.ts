// Immutable BE-38 A copy of the pre-existing 2026 engine tables.
// Deliberately not imported from taxData.ts: later legal corrections must create a new pack ID.
import type { TaxTable } from '../taxData'
import type { Province } from '../types'
export const FEDERAL_2026_SNAPSHOT: TaxTable = {
  "bpa": 16452,
  "bpaMin": 14829,
  "brackets": [
    {
      "upTo": 58523,
      "rate": 0.14
    },
    {
      "upTo": 117045,
      "rate": 0.205
    },
    {
      "upTo": 181440,
      "rate": 0.26
    },
    {
      "upTo": 258482,
      "rate": 0.29
    },
    {
      "upTo": Infinity,
      "rate": 0.33
    }
  ]
}
export const PROVINCIAL_2026_SNAPSHOT: Record<Province, TaxTable> = {
  "ON": {
    "bpa": 12989,
    "brackets": [
      {
        "upTo": 53891,
        "rate": 0.0505
      },
      {
        "upTo": 107785,
        "rate": 0.0915
      },
      {
        "upTo": 150000,
        "rate": 0.1116
      },
      {
        "upTo": 220000,
        "rate": 0.1216
      },
      {
        "upTo": Infinity,
        "rate": 0.1316
      }
    ]
  },
  "QC": {
    "bpa": 18952,
    "brackets": [
      {
        "upTo": 54345,
        "rate": 0.14
      },
      {
        "upTo": 108680,
        "rate": 0.19
      },
      {
        "upTo": 132245,
        "rate": 0.24
      },
      {
        "upTo": Infinity,
        "rate": 0.2575
      }
    ]
  },
  "BC": {
    "bpa": 13216,
    "brackets": [
      {
        "upTo": 50363,
        "rate": 0.056
      },
      {
        "upTo": 100728,
        "rate": 0.077
      },
      {
        "upTo": 115648,
        "rate": 0.105
      },
      {
        "upTo": 140430,
        "rate": 0.1229
      },
      {
        "upTo": 190405,
        "rate": 0.147
      },
      {
        "upTo": 265545,
        "rate": 0.168
      },
      {
        "upTo": Infinity,
        "rate": 0.205
      }
    ]
  },
  "AB": {
    "bpa": 22769,
    "brackets": [
      {
        "upTo": 61200,
        "rate": 0.08
      },
      {
        "upTo": 154259,
        "rate": 0.1
      },
      {
        "upTo": 185111,
        "rate": 0.12
      },
      {
        "upTo": 246813,
        "rate": 0.13
      },
      {
        "upTo": 370220,
        "rate": 0.14
      },
      {
        "upTo": Infinity,
        "rate": 0.15
      }
    ]
  },
  "MB": {
    "bpa": 15780,
    "bpaPhaseOut": {
      "from": 200000,
      "to": 400000,
      "min": 0
    },
    "brackets": [
      {
        "upTo": 47000,
        "rate": 0.108
      },
      {
        "upTo": 100000,
        "rate": 0.1275
      },
      {
        "upTo": Infinity,
        "rate": 0.174
      }
    ]
  },
  "SK": {
    "bpa": 20381,
    "brackets": [
      {
        "upTo": 54532,
        "rate": 0.105
      },
      {
        "upTo": 155805,
        "rate": 0.125
      },
      {
        "upTo": Infinity,
        "rate": 0.145
      }
    ]
  },
  "NS": {
    "bpa": 11932,
    "brackets": [
      {
        "upTo": 30995,
        "rate": 0.0879
      },
      {
        "upTo": 61991,
        "rate": 0.1495
      },
      {
        "upTo": 97417,
        "rate": 0.1667
      },
      {
        "upTo": 157124,
        "rate": 0.175
      },
      {
        "upTo": Infinity,
        "rate": 0.21
      }
    ]
  },
  "NB": {
    "bpa": 13664,
    "brackets": [
      {
        "upTo": 52333,
        "rate": 0.094
      },
      {
        "upTo": 104666,
        "rate": 0.14
      },
      {
        "upTo": 193861,
        "rate": 0.16
      },
      {
        "upTo": Infinity,
        "rate": 0.195
      }
    ]
  },
  "PE": {
    // BE-38 B3: the fourth threshold is the July 2026 T4032-PE figure
    // ($142,520), which replaced January's $142,250 when PE added its sixth
    // bracket over $200,000. The top rate stays at the 20% statutory rate PE
    // enacted; the 21% in the July withholding tables is a six-month prorated
    // withholding rate, not the annual statutory rate.
    "bpa": 15000,
    "brackets": [
      {
        "upTo": 33928,
        "rate": 0.095
      },
      {
        "upTo": 65820,
        "rate": 0.1347
      },
      {
        "upTo": 106890,
        "rate": 0.166
      },
      {
        "upTo": 142520,
        "rate": 0.1762
      },
      {
        "upTo": 200000,
        "rate": 0.19
      },
      {
        "upTo": Infinity,
        "rate": 0.2
      }
    ]
  },
  "NL": {
    "bpa": 13094,
    "brackets": [
      {
        "upTo": 44678,
        "rate": 0.087
      },
      {
        "upTo": 89354,
        "rate": 0.145
      },
      {
        "upTo": 159528,
        "rate": 0.158
      },
      {
        "upTo": 223340,
        "rate": 0.178
      },
      {
        "upTo": 285319,
        "rate": 0.198
      },
      {
        "upTo": 570638,
        "rate": 0.208
      },
      {
        "upTo": 1141275,
        "rate": 0.213
      },
      {
        "upTo": Infinity,
        "rate": 0.218
      }
    ]
  },
  "YT": {
    "bpa": 16452,
    "bpaPhaseOut": {
      "from": 181440,
      "to": 258482,
      "min": 14829
    },
    "brackets": [
      {
        "upTo": 58523,
        "rate": 0.064
      },
      {
        "upTo": 117045,
        "rate": 0.09
      },
      {
        "upTo": 181440,
        "rate": 0.109
      },
      {
        "upTo": 500000,
        "rate": 0.128
      },
      {
        "upTo": Infinity,
        "rate": 0.15
      }
    ]
  },
  "NT": {
    "bpa": 18198,
    "brackets": [
      {
        "upTo": 53003,
        "rate": 0.059
      },
      {
        "upTo": 106009,
        "rate": 0.086
      },
      {
        "upTo": 172346,
        "rate": 0.122
      },
      {
        "upTo": Infinity,
        "rate": 0.1405
      }
    ]
  },
  "NU": {
    "bpa": 19659,
    "brackets": [
      {
        "upTo": 55801,
        "rate": 0.04
      },
      {
        "upTo": 111602,
        "rate": 0.07
      },
      {
        "upTo": 181439,
        "rate": 0.09
      },
      {
        "upTo": Infinity,
        "rate": 0.115
      }
    ]
  }
}
