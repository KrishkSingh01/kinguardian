"""Dependency-free structural checks for KinGuardian's static app shell."""

from html.parser import HTMLParser
from pathlib import Path
import json
import tomllib


ROOT = Path(__file__).resolve().parents[1]
HTML_FILES = ("index.html", "login.html", "setup.html", "change-password.html", "account-setup.html", "pair-device.html", "contacts.html", "invite.html", "sos.html", "location.html")


class PageInspector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.references = []
        self.labels = []
        self.buttons_without_type = []
        self.form_controls = []
        self.inline_scripts = []
        self.external_resources = []
        self.language = None
        self._in_script = False
        self._script_has_source = False
        self._label_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.language = attrs.get("lang")
        if "id" in attrs:
            if attrs["id"] in self.ids:
                raise AssertionError(f"Duplicate id: {attrs['id']}")
            self.ids.add(attrs["id"])
        if "aria-labelledby" in attrs:
            self.references.extend(attrs["aria-labelledby"].split())
        inside_label = self._label_depth > 0
        if tag == "label" and attrs.get("for"):
            self.labels.append(attrs["for"])
        if tag == "label":
            self._label_depth += 1
        if tag in {"input", "select", "textarea"} and attrs.get("type", "").lower() != "hidden":
            self.form_controls.append({
                "id": attrs.get("id"),
                "nested_label": inside_label,
                "aria_label": attrs.get("aria-label"),
                "aria_labelledby": attrs.get("aria-labelledby"),
                "type": attrs.get("type", "").lower(),
                "value": attrs.get("value"),
            })
        if tag == "button" and attrs.get("type") not in {"button", "submit", "reset"}:
            self.buttons_without_type.append(attrs)
        if tag == "script":
            self._in_script = True
            self._script_has_source = bool(attrs.get("src"))
        loaded_resource_attributes = {
            "script": ("src",), "link": ("href",), "img": ("src",),
            "iframe": ("src",), "source": ("src",),
        }
        for attribute in loaded_resource_attributes.get(tag, ()):
            value = attrs.get(attribute, "")
            if value.startswith(("https://", "http://")):
                self.external_resources.append(value)

    def handle_endtag(self, tag):
        if tag == "label" and self._label_depth:
            self._label_depth -= 1
        if tag == "script":
            self._in_script = False
            self._script_has_source = False

    def handle_data(self, data):
        if self._in_script and not self._script_has_source and data.strip():
            self.inline_scripts.append(data.strip()[:80])


def check_local_reference(page: Path, value: str) -> None:
    if not value or value.startswith(("#", "data:", "mailto:", "tel:", "https://", "http://")):
        return
    target = (page.parent / value.split("#", 1)[0].split("?", 1)[0]).resolve()
    if not target.is_file():
        raise AssertionError(f"Missing local resource in {page.name}: {value}")


def main() -> None:
    total_ids = 0
    for filename in HTML_FILES:
        page = ROOT / filename
        source = page.read_text(encoding="utf-8")
        inspector = PageInspector()
        inspector.feed(source)
        if inspector.language != "en":
            raise AssertionError(f"Missing document language in {filename}")
        missing_names = set(inspector.references) - inspector.ids
        if missing_names:
            raise AssertionError(f"Unknown aria-labelledby targets in {filename}: {sorted(missing_names)}")
        if inspector.buttons_without_type:
            raise AssertionError(f"Buttons without an explicit type in {filename}")
        for control in inspector.form_controls:
            has_name = bool(control["nested_label"] or control["aria_label"] or control["aria_labelledby"])
            has_name = has_name or bool(control["id"] and control["id"] in inspector.labels)
            has_name = has_name or control["type"] in {"submit", "button", "reset"} and control["value"]
            if not has_name:
                raise AssertionError(f"Unlabeled form control in {filename}: {control}")
        if inspector.inline_scripts:
            raise AssertionError(f"Inline scripts violate the planned content security policy in {filename}")
        if inspector.external_resources:
            raise AssertionError(f"Unexpected automatically loaded third-party resources in {filename}: {inspector.external_resources}")
        for label_id in inspector.labels:
            if label_id not in inspector.ids:
                raise AssertionError(f"Label target not found in {filename}: {label_id}")
        for match in __import__("re").finditer(r"(?<![\w-])(?:href|src|action)=\"([^\"]+)\"", source):
            check_local_reference(page, match.group(1))
        total_ids += len(inspector.ids)

    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    for icon in manifest["icons"]:
        check_local_reference(ROOT / "index.html", icon["src"])
    routes = json.loads((ROOT / "_routes.json").read_text(encoding="utf-8"))
    if routes != {"version": 1, "include": ["/api/*"], "exclude": []}:
        raise AssertionError("Pages Functions must be limited to /api/* routes")
    for config_path in (ROOT / "wrangler.toml", ROOT / "worker" / "wrangler.toml"):
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        binding = config["d1_databases"][0]
        if binding["binding"] != "DB" or binding["database_name"] != "kinguardian-db":
            raise AssertionError(f"Wrong D1 binding or database name in {config_path.name}")

    print(f"PASS: {len(HTML_FILES)} pages; {total_ids} unique IDs; labels and local resources; no inline scripts or automatically loaded third-party resources; manifest, Pages routes, and D1 names verified.")


if __name__ == "__main__":
    main()
