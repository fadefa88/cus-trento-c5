#!/usr/bin/env python3
"""Verify CUS Trento U23 Serie D cards in CPA Trento official PDFs.

Only confirmed CUS U23 league fixtures are eligible. Never change Coppa,
first-team games, scores, player counts, or other match fields.
Official reports can omit details of a second yellow, so existing card counts
are preserved. Any ambiguous document/athlete is rejected without changing it.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import tempfile
import unicodedata
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = "https://www.figctrento.it/index.php/category/comunicati-ufficiali/"
USER_AGENT = "Mozilla/5.0 (compatible; CUSTRENTO-Futsal-Audit/1.0)"
CURRENT_SEASON = "2026/2027"
CUS_NAMES = {"CUS TRENTO SQ B", "CUS TRENTO U23", "CUS TRENTO U 23", "CUS TRENTO"}
TEAM_ALIASES = {
    "San Floriano 2025": ["SAN FLORIANO 2025", "SAN FLORIANO 2025 A S D", "SAN FLORIANO"],
    "San Floriano": ["SAN FLORIANO 2025", "SAN FLORIANO 2025 A S D", "SAN FLORIANO"],
    "Calcio Bleggio": ["CALCIO BLEGGIO"],
    "Lagarina Futsal": ["LAGARINA FUTSAL ASD", "LAGARINA FUTSAL A.S.D.", "LAGARINA FUTSAL"],
    "Alta Giudicarie": ["ALTA GIUDICARIE A.S.D.", "ALTA GIUDICARIE ASD", "ALTA GIUDICARIE"],
    "Ledrense": ["LEDRENSE A.S.D.", "LEDRENSE ASD", "LEDRENSE"],
    "Settaurense 1934": ["SETTAURENSE 1934", "SETTAURENSE"],
    "Settaurense": ["SETTAURENSE 1934", "SETTAURENSE"],
    "Athesis Calcio": ["ATHESIS CALCIO"],
    "San Giuseppe": ["SAN GIUSEPPE"],
    "Nomi": ["NOMI"],
}
SCORE = re.compile(r"(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$")
# Results from CPA Trento PDF use two columns in the same row, e.g.
# ATHESIS CALCIO    - CUS TRENTO U.23    3-1    BRENTA BORGO    - ...    4-3
RESULT_CELL = re.compile(
    r"(?P<home>[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9. '’/\-]+?)\s{2,}-\s+"
    r"(?P<away>[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9. '’/\-]+?)\s{2,}"
    r"(?P<h>\d{1,2})\s*[-:]\s*(?P<a>\d{1,2})(?=\s{2,}|$)"
)
DATE = re.compile(r"(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(20\d{2})")
U23_PREFIX = re.compile(r"^CAMPIONATO(?:\s+(?:DI|NAZIONALE))?\s+CALCIO\s+A\s*5\s+(?:TRENTO\s+)?SERIE\s+D\b", re.I)


def norm(text):
    text = unicodedata.normalize("NFKD", str(text or "").upper())
    return " ".join(re.findall(r"[A-Z0-9]+", "".join(c for c in text if not unicodedata.combining(c))))


def club_options(name):
    if name == "CUS Trento U23":
        return CUS_NAMES
    return {norm(x) for x in TEAM_ALIASES.get(name, [name])}


def parse_day(source):
    m = DATE.search(source)
    if not m:
        return ""
    try:
        return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return ""


def is_official_pdf(url):
    p = urlparse(url)
    return p.scheme == "https" and p.netloc in {"www.figctrento.it", "figctrento.it"} and (
        "/wp-content/uploads/" in p.path or "/documenti/comunicati/" in p.path
    ) and p.path.lower().endswith(".pdf") and bool(re.search(r"\bCU[_-]\d+", p.path, re.I))


def season_path(url):
    # The official archive spans seasons; CU 145 from June 2026 must not
    # outrank CU 28 from September 2026 just because its number is greater.
    return bool(re.search(r"/(?:2026/(?:07|08|09|10|11|12)|2027/(?:01|02|03|04|05|06))/", url))


def discover(session, pages=9, max_docs=55):
    """Find real 2026/27 Trento bulletins, not nationwide Serie D football."""
    candidates = set()
    articles = []
    pages_read = 0
    for page in range(1, pages + 1):
        target = ARCHIVE if page == 1 else urljoin(ARCHIVE, f"page/{page}/")
        try:
            response = session.get(target, timeout=25, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"::warning::CPA Trento archive page {page} unavailable: {exc}", flush=True)
            continue
        pages_read += 1
        soup = BeautifulSoup(response.text, "html.parser")
        for link in soup.select("a[href]"):
            url = urljoin(target, link["href"])
            if is_official_pdf(url) and season_path(url):
                candidates.add(url)
            label = norm(link.get_text(" ", strip=True))
            if (re.search(r"/2026/(?:09|10|11|12)/", url) and
                (re.search(r"\bC\s*U\b", label) or re.search(r"\bc-u-n-", url, re.I)) and
                urlparse(url).netloc in {"www.figctrento.it", "figctrento.it"} and
                url not in articles):
                articles.append(url)
    if not pages_read:
        raise RuntimeError("No official CPA Trento archive page accessible")
    for target in articles[:max_docs * 2]:
        try:
            response = session.get(target, timeout=25, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"::warning::Official article unavailable: {exc}", flush=True)
            continue
        for a in BeautifulSoup(response.text, "html.parser").select("a[href]"):
            url = urljoin(target, a["href"])
            if is_official_pdf(url) and season_path(url):
                candidates.add(url)
    ranked = sorted(candidates, key=lambda url: (
        urlparse(url).path.split("/wp-content/uploads/")[-1][:7],
        int(re.search(r"CU[_-](\d+)", url, re.I)[1]),
        url
    ), reverse=True)
    if ranked:
        match = re.search(r"/(2026|2027)/(\d{2})/", ranked[0])
        if match and (date.today() - date(int(match[1]), int(match[2]), 1)).days > 70:
            print("::warning::CPA Trento public archive appears stale; cannot validate latest Serie D matches", flush=True)
    return ranked[:max_docs]


def pdf_text(session, url):
    if not is_official_pdf(url):
        raise ValueError("Non-official PDF URL")
    response = session.get(url, timeout=40, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        # Some older official links are intermittently served as an HTML
        # error by the www host. Retry the same verified path via apex domain.
        fallback = url.replace("://www.figctrento.it/", "://figctrento.it/", 1)
        if fallback != url:
            try:
                alternate = session.get(fallback, timeout=35, headers={"User-Agent": USER_AGENT})
                if alternate.status_code == 200 and alternate.content.startswith(b"%PDF"):
                    response = alternate
            except requests.RequestException:
                pass
    if not response.content.startswith(b"%PDF") or len(response.content) > 40_000_000:
        raise ValueError(f"Unexpected official PDF response: HTTP {response.status_code}, "
                         f"content-type {response.headers.get('Content-Type', '?')}, "
                         f"bytes {len(response.content)}")
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "bulletin.pdf"
        file.write_bytes(response.content)
        outcome = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(file), "-"],
            check=True, capture_output=True, text=True, timeout=45,
        )
    result = outcome.stdout.replace("\u00a0", " ")
    # pdftotext -layout can add thousands of blank padding characters to
    # the first page. Inspect the first 12k characters, not just the first 1.7k.
    first_page = norm(result[:12000])
    if not re.search(r"STAGIONE SPORTIVA\s+202\s*6\s+2027\b", first_page):
        raise ValueError(f"Not a 2026/27 Trento bulletin. Season markers: {re.findall(r'STAGIONE SPORTIVA.{0,32}', first_page)[:2]!r}")
    if "COMITATO PROVINCIALE AUTONOMO DI TRENTO" not in first_page:
        raise ValueError("Missing CPA Trento official identification")
    return result


def sections(text):
    """Keep Serie D futsal blocks separate from youth, Coppa and all football leagues."""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if U23_PREFIX.match(line.strip()):
            # Block ends when a different competition/section starts.
            stop = index + 1
            while stop < len(lines):
                n = norm(lines[stop])
                if (re.match(r"^(?:CAMPIONATO|COPPA|TORNEO) ", n) or
                    re.match(r"^(?:GIUSTIZIA SPORTIVA|LEGENDA|PUBBLICATO IN TRENTO|DECISIONI DEL GIUDICE SPORTIVO)", n)):
                    break
                stop += 1
            yield "\n".join(lines[index:stop])


def official_result_dates(section):
    # Multiple match dates may appear in weekly bulletins.
    return {
        parse_day(match.group(1))
        for match in re.finditer(
            r"RISULTATI\s+UFFICIALI\s+GARE\s+DEL\s+(\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2})",
            section, re.I
        )
        if parse_day(match.group(1))
    }


def confirms_match(text, match):
    if match.get("competition") != "Campionato" or match.get("status") != "Terminata":
        return False
    if match.get("score") is None or "CUS Trento U23" not in (match.get("home"), match.get("away")):
        return False
    # Match must appear explicitly in the Serie D futsal results, with a compatible date.
    score = str(match["score"]).replace(" ", "").replace(":", "-")
    for section in sections(text):
        if "RISULTATI UFFICIALI" not in norm(section):
            continue
        dates = official_result_dates(section)
        if not dates or match["date"] not in dates:
            continue
        for line in section.splitlines():
            for m in RESULT_CELL.finditer(line):
                if (f"{m['h']}-{m['a']}" == score
                        and norm(m["home"]) in club_options(match["home"])
                        and norm(m["away"]) in club_options(match["away"])):
                    return True
            # Single-column compact lines found in some older bulletins.
            m = SCORE.search(line)
            if m and f"{m[1]}-{m[2]}" == score:
                lhs = line[:m.start()].strip()
                pair = re.split(r"\s+-\s+", lhs, maxsplit=1)
                if (len(pair) == 2 and norm(pair[0]) in club_options(match["home"])
                        and norm(pair[1]) in club_options(match["away"])):
                    return True
    return False


def sanction_date(section):
    for m in re.finditer(r"GARE\s+DEL\s+(\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2})", section, re.I):
        day = parse_day(m[1])
        if day:
            return day
    return ""


def c_us_sanctions(text, match_day):
    """Read names from 'CALCIATORI ESPULSI/NON ESPULSI' only; no coach sanctions.

    Name and club can occupy separate lines. Count and type of each individual
    yellow cannot always be deduced from a disciplinary bulletin, so additions
    are one card unless the existing CMS already records double-yellow.
    """
    # A single Serie D justice section may contain several independent
    # "GARE DEL ..." groups, even two distinct blocks for the same day.
    disciplinary_sections = [part for part in sections(text)
                             if "PROVVEDIMENTI DISCIPLINARI" in norm(part)]
    if len(disciplinary_sections) != 1:
        raise ValueError(f"Expected exactly one Serie D justice section, got {len(disciplinary_sections)}")
    chunks = re.split(
        r"(?=^\s*GARE\s+DEL\s+\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2}\s*$)",
        disciplinary_sections[0],
        flags=re.I | re.M,
    )
    relevant = [part for part in chunks
                if sanction_date(part) == match_day and "PROVVEDIMENTI DISCIPLINARI" in norm(part)]
    if not relevant:
        raise ValueError(f"No date-specific Serie D disciplinary section for {match_day}")
    # Process only the exact match-date blocks. Never carry player names across
    # separate dates or across unrelated competition headings.
    text = "\n".join(relevant)
    if "CALCIATORI" not in norm(text):
        raise ValueError("Missing disciplinary player headers")
    state = None
    subsection = None
    yellow, red = set(), set()
    pending = ""
    for line in text.splitlines():
        row = norm(line)
        if re.match(r"^CALCIATORI ESPULSI\b", row):
            state, subsection, pending = "red", None, ""
            continue
        if re.match(r"^CALCIATORI NON ESPULSI\b", row):
            state, subsection, pending = "yellow", None, ""
            continue
        if re.match(r"^(?:DIRIGENTI|ALLENATORI|SOCIETA)\b", row):
            state, subsection, pending = None, None, ""
            continue
        if "AMMONIZIONE" in row and re.match(r"^(?:(?:I|II|III|IV|V|VI|\d+)\s+)?AMMONIZIONE\b", row):
            subsection, pending = "yellow", ""
            continue
        if re.match(r"^SQUALIFICA\b", row):
            # Suspensions of a player NOT sent off (e.g. misconduct or accumulated
            # bookings) are NOT red cards. Only the "CALCIATORI ESPULSI"
            # section authorizes a red; recidiva in ammonizione authorizes yellow.
            if state == "red":
                subsection = "red"
            elif "RECIDIVITA IN AMMONIZIONE" in row or "RECIDIVA IN AMMONIZIONE" in row:
                subsection = "yellow"
            else:
                subsection = None
            pending = ""
            continue
        if row.startswith("PROVVEDIMENTI DISCIPLINARI"):
            state = None
            continue
        if not state:
            continue
        if re.match(r"^\s*\(\s*[^()]+\s*\)\s*$", line):
            club = norm(line.strip()[1:-1])
            if club in CUS_NAMES and pending and subsection:
                (yellow if subsection == "yellow" else red).add(pending)
            pending = ""
            continue
        # CPA Trento publishes two parallel player columns, so a line can be:
        # CONTI DIEGO     (CUS TRENTO U.23)      PITTINO ANDREA   (OTHER)
        # An anchored, one-name-per-line regex misses BOTH names.
        pairs = list(re.finditer(
            r"([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý '\-.]{3,}?)\s+\(([^()]+)\)", line
        ))
        if pairs:
            if subsection:
                for pair in pairs:
                    if norm(pair[2]) in CUS_NAMES:
                        (yellow if subsection == "yellow" else red).add(norm(pair[1]))
            pending = ""
            continue
        # A standalone uppercase player name is followed by a club in parentheses.
        if re.fullmatch(r"[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý '\-.]{4,}", line.strip()) and not row.startswith((
            "CALCIATORI", "SQUALIFICA", "AMMONIZIONE", "PROVVEDIMENTI", "IN BASE", "GARE", "GIRONE"
        )):
            pending = norm(line)
    if not ("CALCIATORI ESPULSI" in norm(text) or "CALCIATORI NON ESPULSI" in norm(text)):
        raise ValueError("No player discipline headings")
    return yellow, red


def resolve_player(official_name, roster, called):
    matches = [str(p["id"]) for p in roster if str(p["id"]) in called
               and Counter(norm(p.get("name", "")).split()) == Counter(norm(official_name).split())]
    if len(matches) != 1:
        raise ValueError(f"Cannot uniquely identify CUS U23 player {official_name!r}: {len(matches)} matches")
    return matches[0]


def add_verified_cards(match, roster, yellows, reds):
    if match.get("competition") != "Campionato" or "CUS Trento U23" not in (match.get("home"), match.get("away")):
        raise ValueError("Not a CUS Under 23 league fixture")
    lineup = match.get("lineup") or {}
    called = {str(v) for v in (lineup.get("startingFive") or []) + (lineup.get("bench") or [])}
    if not called:
        raise ValueError("Missing U23 lineup")
    yellow_ids = {resolve_player(n, roster, called) for n in yellows}
    red_ids = {resolve_player(n, roster, called) for n in reds}
    # This is additive only: never remove manually entered cards or double-yellow events.
    changed = False
    for key, ids in (("yellowCardEvents", yellow_ids), ("redCardEvents", red_ids)):
        current = match.get(key) or []
        existing = {str(e.get("playerId")) for e in current}
        for ident in sorted(ids - existing):
            current.append({"playerId": ident, "cards": 1})
            changed = True
        if changed:
            match[key] = current
    return changed


def update_site(root, reports, apply=False):
    """Compare league results and official discipline independently.

    These are often published in different C.U. files. A matching result
    establishes the identity of the game; only then may date-scoped Serie D
    disciplinary entries be attributed to CUS U23. Never infer a red card
    from a non-expelled player's suspension, and never discard manual cards.
    """
    cms_path = root / "content/cms/u21-fixtures.json"
    data_path = root / "content/data.json"
    cms = json.loads(cms_path.read_text(encoding="utf-8"))
    site = json.loads(data_path.read_text(encoding="utf-8"))
    roster = site["roster"]
    verified = {}
    matches_with_result = set()
    matches_with_conflicts = set()
    changed_matches = set()
    all_fixtures = [
        m for m in cms["u21Fixtures"]
        if m.get("competition") == "Campionato"
        and m.get("status") == "Terminata"
        and m.get("score")
        and "CUS Trento U23" in (m.get("home"), m.get("away"))
    ]
    for match in all_fixtures:
        game_reports = [url for url, text in reports if confirms_match(text, match)]
        if not game_reports:
            continue
        matches_with_result.add(match["id"])
        discipline = []
        for url, content in reports:
            try:
                cautions, dismissals = c_us_sanctions(content, match["date"])
                discipline.append((url, cautions, dismissals))
            except ValueError:
                # A communiqué with only results has no disciplinary section.
                # A partially readable discipline section must never authorize
                # an update on its own.
                continue
        if not discipline:
            print(f"::warning::Official result found but no readable Serie D discipline "
                  f"for {match['date']}: {match['id']}", flush=True)
            continue
        cautions = set().union(*(entry[1] for entry in discipline))
        dismissals = set().union(*(entry[2] for entry in discipline))
        # Some bulletins only show a subset of sanctions. Treat missing entries
        # as uncertain, not proof that a manually recorded booking was wrong.
        if not (cautions or dismissals) and (
                match.get("yellowCardEvents") or match.get("redCardEvents")):
            matches_with_conflicts.add(match["id"])
            print(f"::warning::Official sanctions parser found zero CUS cards but "
                  f"the match contains manually entered cards: {match['id']}", flush=True)
            continue
        try:
            proposed = copy.deepcopy(match)
            changed = add_verified_cards(proposed, roster, cautions, dismissals)
            originals = [
                other for other in site["u21Fixtures"] if other.get("id") == match["id"]
            ]
            if len(originals) != 1 or originals[0].get("score") != match["score"]:
                raise ValueError("The CMS and public match are not aligned")
            # Check that all non-card fields would remain byte-equivalent before
            # applying changes in either copy.
            for key in match:
                if key not in ("yellowCardEvents", "redCardEvents") and proposed[key] != match[key]:
                    raise ValueError(f"Unexpected non-card change: {key}")
            add_verified_cards(match, roster, cautions, dismissals)
            add_verified_cards(originals[0], roster, cautions, dismissals)
            if match != proposed:
                raise ValueError("Unexpected CMS match difference")
            verified[match["id"]] = (cautions, dismissals)
            if changed:
                changed_matches.add(match["id"])
            print(f"VERIFIED Serie D {match['date']} {match['home']} - {match['away']}: "
                  f"{len(cautions)} cautioned, {len(dismissals)} expelled; "
                  f"results={len(game_reports)}, sanction_CUs={len(discipline)}",
                  flush=True)
        except ValueError as exc:
            matches_with_conflicts.add(match["id"])
            print(f"::warning::Cannot safely resolve cards for {match['id']}: {exc}",
                  flush=True)

    original_cms = json.loads(cms_path.read_text(encoding="utf-8"))
    original_site = json.loads(data_path.read_text(encoding="utf-8"))
    dirty = cms != original_cms or site != original_site
    if dirty and apply:
        cms_path.write_text(json.dumps(cms, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        data_path.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for match in sorted(all_fixtures, key=lambda m: m["date"]):
        ident = match["id"]
        if ident in verified:
            status = "CONFIRMED"
        elif ident in matches_with_conflicts:
            status = "CONFLICT: requires manual verification"
        elif ident in matches_with_result:
            status = "RESULT_ONLY: disciplinary PDF unavailable or ambiguous"
        else:
            status = "UNVERIFIED: no exact official result matched"
        print(f"AUDIT {match['date']} {match['home']} - {match['away']}: {status}", flush=True)
    print(f"Official Serie D U23 verified {len(verified)}/{len(all_fixtures)} matches; "
          f"card corrections={len(changed_matches)}; files changed={dirty and apply}",
          flush=True)
    return dirty


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with requests.Session() as session:
        urls = discover(session)
        print(f"Discovered official CPA Trento bulletin PDFs: {len(urls)}", flush=True)
        if not urls:
            print("::warning::No recent official CPA Trento PDFs found. Skipping changes.", flush=True)
            return 0
        reports = []
        for url in urls:
            try:
                content = pdf_text(session, url)
                reports.append((url, content))
            except (ValueError, requests.RequestException, subprocess.SubprocessError) as exc:
                print(f"::warning::Cannot parse {url}: {exc}", flush=True)
        if not reports:
            print("::warning::No readable verified 2026/27 PDFs. Nothing changed.", flush=True)
            return 0
    # Diagnostic: show the exact official league result lines (never personal data).
    for url, content in reports:
        for part in sections(content):
            if "RISULTATI UFFICIALI" not in norm(part):
                continue
            lines = [line.strip()[:175] for line in part.splitlines()
                     if "CUS TRENTO" in norm(line) and " - " in line and re.search(r"\d+\s*[-:]\s*\d+", line)]
            if lines:
                print(f"RESULTS {url.rsplit('/', 1)[-1]}: dates={sorted(official_result_dates(part))}; lines={lines[:7]}", flush=True)
    # Diagnostics for historical fixtures with manually recorded dismissals.
    # These excerpts come only from public official Serie D justice reports.
    for url, content in reports:
        for block in sections(content):
            if "PROVVEDIMENTI DISCIPLINARI" not in norm(block):
                continue
            pieces = re.split(
                r"(?=^\s*GARE\s+DEL\s+\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2}\s*$)",
                block, flags=re.I | re.M
            )
            for piece in pieces:
                when = sanction_date(piece)
                if when not in {"2026-10-02", "2026-10-16", "2026-10-23", "2026-09-25", "2026-10-30"}:
                    continue
                lines = piece.splitlines()
                relevant = []
                for idx, line in enumerate(lines):
                    if "CUS TRENTO" in norm(line):
                        relevant.append(" | ".join(
                            q.strip()[:100] for q in lines[max(0, idx-3):min(len(lines), idx+2)]
                        ))
                headers = [line.strip() for line in lines if re.match(
                    r"^\s*(?:CALCIATORI|SQUALIFICA|AMMONIZIONE|(?:I|II|III|IV)\s+AMMONIZIONE)",line,re.I)]
                print(f"DIAG C.U. {url.rsplit('/',1)[-1]} date={when} "
                      f"club_occurrences={relevant[:8]} headers={headers[:14]}", flush=True)
    update_site(args.root, reports, args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
