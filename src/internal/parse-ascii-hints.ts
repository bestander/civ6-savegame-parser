/**
 * Modifier identities and notifications show up as ASCII, not POLICY_* / PROMOTION_* names.
 * God King / Ilkum / Ranger / scientific CS small-influence were pinned this way.
 */

const MODIFIER_RE = /(?:GOD_KING_|ILKUM_|DISCIPLINE_|RANGER_|MINOR_CIV_|MONUMENT_|GOODY_|TEMPLE_ARTEMIS_)[A-Z0-9_!|>]+/g;
const TECH_NAME_RE = /LOC_TECH_[A-Z0-9_]+_NAME/g;
const CIVIC_NAME_RE = /LOC_CIVIC_[A-Z0-9_]+_NAME/g;
const NOTIF_RE = /LOC_NOTIFICATION_[A-Z0-9_]+/g;

function uniqueMatches(payload: Buffer, re: RegExp): string[] {
    const text = payload.toString('latin1');
    const found = text.match(re) ?? [];
    return [...new Set(found)].sort();
}

export interface Civ6SaveAsciiHints {
    /** Attached modifier ids (policies, promotions, CS influence, goody rewards). */
    modifiers: string[];
    techNames: string[];
    civicNames: string[];
    notifications: string[];
}

export function parseAsciiHints(payload: Buffer): Civ6SaveAsciiHints {
    return {
        modifiers: uniqueMatches(payload, MODIFIER_RE),
        techNames: uniqueMatches(payload, TECH_NAME_RE),
        civicNames: uniqueMatches(payload, CIVIC_NAME_RE),
        notifications: uniqueMatches(payload, NOTIF_RE),
    };
}
