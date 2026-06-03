#!/usr/bin/env python3
"""Sync Decap CMS player select options from content/cms/roster.json.

The site stores the roster as JSON, while Decap CMS select widgets need their
options inside admin/config.yml. This script regenerates the player options used
in match lineups/events so the CMS dropdowns follow the roster automatically.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

try:
    import yaml
except ImportError as exc:  # pragma: no cover - handled in GitHub Actions by pip install
    raise SystemExit("Missing dependency: PyYAML. Install with: pip install pyyaml") from exc

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROSTER_PATH = ROOT / "content" / "cms" / "roster.json"
DEFAULT_CONFIG_PATH = ROOT / "admin" / "config.yml"

FIRST_TEAM_COLLECTIONS = {"fixtures", "cup"}
U21_COLLECTIONS = {"u21Fixtures", "u21Cup"}
LINEUP_FIELD_NAMES = {"startingFive", "bench", "suspended", "injured"}
PLAYER_ID_FIELD_NAME = "playerId"
GOALKEEPER_EVENT_NAME = "goalkeeperEvents"
GOALKEEPER_ROLE = "Portiere"


class NoAliasDumper(yaml.SafeDumper):
    def ignore_aliases(self, data: Any) -> bool:
        return True


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_yaml(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} does not contain a YAML object")
    return data


def write_yaml(path: Path, data: Dict[str, Any]) -> None:
    text = yaml.dump(
        data,
        Dumper=NoAliasDumper,
        allow_unicode=True,
        sort_keys=False,
        width=120,
        default_flow_style=False,
    )
    # Keep Decap-friendly LF endings and no trailing blank storm.
    path.write_text(text, encoding="utf-8")


def normalize_player(raw: Dict[str, Any]) -> Dict[str, Any] | None:
    player_id = raw.get("id")
    name = str(raw.get("name") or "").strip()
    team = str(raw.get("team") or "").strip()
    if player_id in (None, "") or not name or not team:
        return None

    try:
        number = int(raw.get("number"))
    except (TypeError, ValueError):
        number = 9999

    return {
        "id": str(player_id),
        "name": name,
        "team": team,
        "number": number,
        "role": str(raw.get("role") or "").strip(),
    }


def option_for_player(player: Dict[str, Any]) -> Dict[str, str]:
    number = player.get("number")
    if isinstance(number, int) and number != 9999:
        label = f"#{number} {player['name']}"
    else:
        label = player["name"]
    return {"label": label, "value": player["id"]}


def build_options(roster_data: Dict[str, Any]) -> Dict[str, Dict[str, List[Dict[str, str]]]]:
    players = [normalize_player(item) for item in roster_data.get("roster", [])]
    players = [player for player in players if player]
    players.sort(key=lambda p: (p.get("number", 9999), p["name"].lower()))

    result: Dict[str, Dict[str, List[Dict[str, str]]]] = {}
    for team_name in ("Prima squadra", "Under 21"):
        team_players = [player for player in players if player["team"] == team_name]
        goalkeeper_players = [player for player in team_players if player.get("role") == GOALKEEPER_ROLE]
        result[team_name] = {
            "all": [option_for_player(player) for player in team_players],
            "goalkeepers": [option_for_player(player) for player in goalkeeper_players] or [option_for_player(player) for player in team_players],
        }
    return result


def iter_field_dicts(node: Any, ancestors: Iterable[Dict[str, Any]] = ()) -> Iterable[tuple[Dict[str, Any], List[Dict[str, Any]]]]:
    if isinstance(node, dict):
        current_ancestors = list(ancestors)
        if "widget" in node or "fields" in node or "field" in node:
            yield node, current_ancestors
            current_ancestors = current_ancestors + [node]
        for key in ("fields", "files"):
            value = node.get(key)
            if isinstance(value, list):
                for item in value:
                    yield from iter_field_dicts(item, current_ancestors)
        field = node.get("field")
        if isinstance(field, dict):
            yield from iter_field_dicts(field, current_ancestors)
    elif isinstance(node, list):
        for item in node:
            yield from iter_field_dicts(item, ancestors)


def is_goalkeeper_player_field(field: Dict[str, Any], ancestors: List[Dict[str, Any]]) -> bool:
    if field.get("name") != PLAYER_ID_FIELD_NAME:
        return False
    return any(parent.get("name") == GOALKEEPER_EVENT_NAME for parent in ancestors)


def should_update_field(field: Dict[str, Any]) -> bool:
    if field.get("widget") != "select":
        return False
    name = field.get("name")
    return name in LINEUP_FIELD_NAMES or name == PLAYER_ID_FIELD_NAME


def collection_team(collection_name: str) -> str | None:
    if collection_name in FIRST_TEAM_COLLECTIONS:
        return "Prima squadra"
    if collection_name in U21_COLLECTIONS:
        return "Under 21"
    return None


def sync_config(config_data: Dict[str, Any], options_by_team: Dict[str, Dict[str, List[Dict[str, str]]]]) -> int:
    changed = 0
    collections = config_data.get("collections", [])
    if not isinstance(collections, list):
        raise ValueError("admin/config.yml: collections must be a list")

    for collection in collections:
        if not isinstance(collection, dict):
            continue
        team = collection_team(str(collection.get("name") or ""))
        if not team:
            continue

        team_options = options_by_team.get(team, {})
        all_options = team_options.get("all", [])
        goalkeeper_options = team_options.get("goalkeepers", [])
        if not all_options:
            print(f"WARNING: no roster players found for {team}; leaving collection {collection.get('name')} unchanged")
            continue

        for field, ancestors in iter_field_dicts(collection):
            if not should_update_field(field):
                continue

            new_options = goalkeeper_options if is_goalkeeper_player_field(field, ancestors) else all_options
            if field.get("options") != new_options:
                field["options"] = copy.deepcopy(new_options)
                changed += 1

    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync CMS player dropdown options from roster.json")
    parser.add_argument("--roster", type=Path, default=DEFAULT_ROSTER_PATH)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    args = parser.parse_args()

    roster_data = load_json(args.roster)
    config_data = load_yaml(args.config)
    options_by_team = build_options(roster_data)

    changed_fields = sync_config(config_data, options_by_team)
    if changed_fields:
        write_yaml(args.config, config_data)
        print(f"Updated {changed_fields} player select field(s) in {args.config}")
    else:
        print("Roster options already in sync. No changes needed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
