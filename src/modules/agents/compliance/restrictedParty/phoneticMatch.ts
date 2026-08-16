// Restricted / Denied-Party Screening -- phonetic matching.
//
// Self-contained, dependency-free port of Lawrence Philips' Double Metaphone
// algorithm (public domain). Used ONLY for candidate shortlisting -- a
// phonetic-code collision surfaces a candidate for scoring, it is never
// itself the pass/fail signal, and every phonetic hit is recorded honestly
// as matchMethod "DOUBLE_METAPHONE" so it reads as a lighter-weight tier
// than EXACT/RAW_WORD. This is a lightweight implementation for shortlisting,
// not a certified library -- documented PARTIAL per the implementation plan.

function isVowel(c: string | undefined): boolean {
  return !!c && "AEIOU".includes(c);
}

/**
 * Returns [primary, secondary] phonetic codes for `input`. Secondary equals
 * primary when the algorithm finds no meaningful alternate encoding.
 */
export function doubleMetaphone(input: string): [string, string] {
  const word = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (!word) return ["", ""];

  const n = word.length;
  let i = 0;
  let primary = "";
  let secondary = "";
  const isSlavoGermanic = /W|K|CZ|WITZ/.test(word);

  const at = (idx: number) => (idx >= 0 && idx < n ? word[idx] : "");
  const substr = (start: number, len: number) => word.slice(Math.max(start, 0), Math.max(start, 0) + len);

  // Skip silent leading letter combinations.
  if (/^(GN|KN|PN|WR|PS)/.test(word)) i = 1;
  if (at(0) === "X") {
    primary += "S";
    secondary += "S";
    i = 1;
  }

  const MAX = 32;
  while (i < n && primary.length < MAX && secondary.length < MAX) {
    const c = at(i);

    if (isVowel(c)) {
      if (i === 0) {
        primary += "A";
        secondary += "A";
      }
      i++;
      continue;
    }

    switch (c) {
      case "B":
        primary += "P";
        secondary += "P";
        i += at(i + 1) === "B" ? 2 : 1;
        break;
      case "Ç":
        primary += "S";
        secondary += "S";
        i++;
        break;
      case "C":
        if (substr(i, 4) === "CHIA") {
          primary += "K";
          secondary += "K";
          i += 2;
        } else if (substr(i, 2) === "CH") {
          if (i > 0 && substr(i, 4) === "CHAE") {
            primary += "K";
            secondary += "X";
            i += 2;
          } else if (i === 0 && (/^(CHOR|CHOL)/.test(substr(i, 4)) || /^(CHIA|CHEM)/.test(substr(i, 4)))) {
            primary += "K";
            secondary += "K";
            i += 2;
          } else {
            primary += "X";
            secondary += "X";
            i += 2;
          }
        } else if (c === "C" && at(i + 1) === "Z" && substr(i - 2, 2) !== "WI") {
          primary += "S";
          secondary += "X";
          i += 2;
        } else if (at(i + 1) === "C" && !(i === 1 && at(0) === "M")) {
          if (/[IEY]/.test(at(i + 2)) && substr(i + 2, 1) !== "H") {
            if (substr(i, 3) === "CCI") {
              primary += "S";
              secondary += "S";
            } else {
              primary += "X";
              secondary += "X";
            }
            i += 3;
          } else {
            primary += "K";
            secondary += "K";
            i += 2;
          }
        } else if (/[KGQ]/.test(at(i + 1))) {
          primary += "K";
          secondary += "K";
          i += 2;
        } else if (/[IEY]/.test(at(i + 1))) {
          primary += "S";
          secondary += "S";
          i += 2;
        } else {
          primary += "K";
          secondary += "K";
          i += at(i + 1) === "C" ? 2 : 1;
        }
        break;
      case "D":
        if (substr(i, 2) === "DG") {
          if (/[IEY]/.test(at(i + 2))) {
            primary += "J";
            secondary += "J";
            i += 3;
          } else {
            primary += "TK";
            secondary += "TK";
            i += 2;
          }
        } else {
          primary += "T";
          secondary += "T";
          i += at(i + 1) === "D" ? 2 : 1;
        }
        break;
      case "F":
        primary += "F";
        secondary += "F";
        i += at(i + 1) === "F" ? 2 : 1;
        break;
      case "G":
        if (at(i + 1) === "H") {
          if (i > 0 && !isVowel(at(i - 1))) {
            primary += "K";
            secondary += "K";
            i += 2;
          } else if (i === 0) {
            primary += at(i + 2) === "I" ? "J" : "K";
            secondary += at(i + 2) === "I" ? "J" : "K";
            i += 2;
          } else {
            i += 2;
          }
        } else if (at(i + 1) === "N") {
          primary += "K";
          secondary += "KN";
          i += 2;
        } else if (substr(i + 1, 2) === "LI" && !isSlavoGermanic) {
          primary += "KL";
          secondary += "L";
          i += 2;
        } else if (i === 0 && (at(i + 1) === "Y" || /[EIY]/.test(at(i + 1)))) {
          primary += "K";
          secondary += "J";
          i += 2;
        } else if ((at(i + 1) === "E" && at(i + 2) === "R") || at(i + 1) === "Y" || (i === 0 && /[IEY]/.test(at(i + 1)))) {
          primary += "K";
          secondary += "J";
          i += 2;
        } else if (/[IEY]/.test(at(i + 1)) || substr(i - 1, 3) === "AGGI" || substr(i - 1, 3) === "OGGI") {
          if (isSlavoGermanic) {
            primary += "K";
            secondary += "K";
          } else {
            primary += "K";
            secondary += "J";
          }
          i += 2;
        } else if (at(i + 1) === "G") {
          primary += "K";
          secondary += "K";
          i += 2;
        } else {
          primary += "K";
          secondary += "K";
          i += 1;
        }
        break;
      case "H":
        if (isVowel(at(i - 1)) && isVowel(at(i + 1))) {
          primary += "H";
          secondary += "H";
          i += 2;
        } else {
          i += 1;
        }
        break;
      case "J":
        if (substr(i, 4) === "JOSE" || substr(0, 4) === "SAN ") {
          primary += "H";
          secondary += "H";
          i += 1;
        } else {
          primary += "J";
          secondary += "A";
          i += at(i + 1) === "J" ? 2 : 1;
        }
        break;
      case "K":
        primary += "K";
        secondary += "K";
        i += at(i + 1) === "K" ? 2 : 1;
        break;
      case "L":
        if (at(i + 1) === "L") {
          primary += "L";
          secondary += "L";
          i += 2;
        } else {
          primary += "L";
          secondary += "L";
          i += 1;
        }
        break;
      case "M":
        primary += "M";
        secondary += "M";
        i += substr(i + 1, 2) === "MB" ? 2 : at(i + 1) === "M" ? 2 : 1;
        break;
      case "N":
        primary += "N";
        secondary += "N";
        i += at(i + 1) === "N" ? 2 : 1;
        break;
      case "Ñ":
        primary += "N";
        secondary += "N";
        i += 1;
        break;
      case "P":
        if (at(i + 1) === "H") {
          primary += "F";
          secondary += "F";
          i += 2;
        } else {
          primary += "P";
          secondary += "P";
          i += /[PB]/.test(at(i + 1)) ? 2 : 1;
        }
        break;
      case "Q":
        primary += "K";
        secondary += "K";
        i += at(i + 1) === "Q" ? 2 : 1;
        break;
      case "R":
        if (i === n - 1 && !isSlavoGermanic && substr(i - 2, 2) === "IE" && !/(ME|MA)$/.test(substr(0, i))) {
          secondary += "R";
        } else {
          primary += "R";
          secondary += "R";
        }
        i += at(i + 1) === "R" ? 2 : 1;
        break;
      case "S":
        if (substr(i - 1, 3) === "ISL" || substr(i - 1, 3) === "YSL") {
          i += 1;
        } else if (i === 0 && substr(i, 5) === "SUGAR") {
          primary += "X";
          secondary += "S";
          i += 1;
        } else if (substr(i, 2) === "SH") {
          primary += /HEIM|HOEK|HOLM|HOLZ/.test(substr(i + 1, 4)) ? "S" : "X";
          secondary += /HEIM|HOEK|HOLM|HOLZ/.test(substr(i + 1, 4)) ? "S" : "X";
          i += 2;
        } else if (/SIO|SIA/.test(substr(i, 3))) {
          if (!isSlavoGermanic) {
            primary += "S";
            secondary += "X";
          } else {
            primary += "S";
            secondary += "S";
          }
          i += 3;
        } else if (i === 0 && isVowel(at(i + 1)) === false && at(i + 1) !== "S") {
          primary += "S";
          secondary += "S";
          i += 1;
        } else if (substr(i, 2) === "SZ") {
          primary += "S";
          secondary += "X";
          i += 2;
        } else if (substr(i, 2) === "SC") {
          if (at(i + 2) === "H") {
            if (/OO|ER|EN|UY|ED|EM/.test(substr(i + 3, 2))) {
              primary += "SK";
              secondary += "SK";
            } else if (i === 0 && !isVowel(at(3)) && at(3) !== "W") {
              primary += "X";
              secondary += "SK";
            } else {
              primary += "X";
              secondary += "X";
            }
          } else if (/[IEY]/.test(at(i + 2))) {
            primary += "S";
            secondary += "S";
          } else {
            primary += "SK";
            secondary += "SK";
          }
          i += 3;
        } else {
          primary += "S";
          secondary += "S";
          i += at(i + 1) === "S" ? 2 : 1;
        }
        break;
      case "T":
        if (substr(i, 4) === "TION") {
          primary += "X";
          secondary += "X";
          i += 3;
        } else if (/TIA|TCH/.test(substr(i, 3))) {
          primary += "X";
          secondary += "X";
          i += 3;
        } else if (substr(i, 2) === "TH" || substr(i, 3) === "TTH") {
          primary += "0";
          secondary += "T";
          i += 2;
        } else {
          primary += "T";
          secondary += "T";
          i += /[TD]/.test(at(i + 1)) ? 2 : 1;
        }
        break;
      case "V":
        primary += "F";
        secondary += "F";
        i += at(i + 1) === "V" ? 2 : 1;
        break;
      case "W":
        if (substr(i, 2) === "WR") {
          primary += "R";
          secondary += "R";
          i += 2;
        } else if (i === 0 && (isVowel(at(i + 1)) || substr(i, 2) === "WH")) {
          if (isVowel(at(i + 1))) {
            primary += "A";
            secondary += "F";
          } else {
            primary += "A";
            secondary += "A";
          }
          i += 1;
        } else if ((i === n - 1 && isVowel(at(i - 1))) || substr(i - 1, 5) === "EWSKI" || substr(0, 3) === "SCH") {
          secondary += "F";
          i += 1;
        } else if (/^(WICZ|WITZ)/.test(substr(i, 4))) {
          primary += "TS";
          secondary += "FX";
          i += 4;
        } else {
          i += 1;
        }
        break;
      case "X":
        if (!(i === n - 1 && (/(IAU|EAU)$/.test(substr(i - 3, 3)) || /(AU|OU)$/.test(substr(i - 2, 2))))) {
          primary += "KS";
          secondary += "KS";
        }
        i += /[CX]/.test(at(i + 1)) ? 2 : 1;
        break;
      case "Z":
        if (at(i + 1) === "H") {
          primary += "J";
          secondary += "J";
          i += 2;
        } else {
          if (/ZO|ZI|ZA/.test(substr(i + 1, 2)) || (isSlavoGermanic && i > 0 && at(i - 1) !== "T")) {
            primary += "S";
            secondary += "TS";
          } else {
            primary += "S";
            secondary += "S";
          }
          i += at(i + 1) === "Z" ? 2 : 1;
        }
        break;
      default:
        i += 1;
        break;
    }
  }

  if (secondary === "") secondary = primary;
  return [primary.slice(0, MAX), secondary.slice(0, MAX)];
}

/** True if any of `a`'s [primary, secondary] codes matches any of `b`'s -- the standard double-metaphone comparison. */
export function doubleMetaphoneMatches(a: string, b: string): boolean {
  const [ap, as_] = doubleMetaphone(a);
  const [bp, bs] = doubleMetaphone(b);
  if (!ap && !as_) return false;
  return ap === bp || ap === bs || as_ === bp || (as_ !== "" && as_ === bs);
}
