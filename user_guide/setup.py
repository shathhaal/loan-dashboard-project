import os

import frappe
from frappe.modules.import_file import import_file_by_path

BLOCK_NAME = "AFPPF User Guide"
WORKSPACE_NAME = "دليل المستخدم"

# The workspace was first created as `User Guide` carrying an Arabic `title`.
# That breaks navigation: the sidebar builds its link from the title
# (`/app/${slug(item.title)}` in workspace.js) while the router table
# `frappe.workspaces` is keyed by `slug(name)` (desk.js). The two only agree
# when name == title, so a mismatched pair falls through to doctype routing
# and renders "not found". Kept here so the broken record is cleaned up on
# any site that received the first version.
_LEGACY_WORKSPACE_NAMES = ("User Guide",)

_HERE = os.path.dirname(os.path.abspath(__file__))
_APP = os.path.dirname(_HERE)
_WORKSPACE_FILE = os.path.join(
    _APP, "afppf_project_management", "workspace", "user_guide", "user_guide.json"
)


def _read(filename):
    with open(os.path.join(_HERE, filename), encoding="utf-8") as handle:
        return handle.read()


def execute():
    """Installs the «دليل المستخدم» workspace and the block that renders it.

    The guide's markup, styling and behaviour live in guide.html/.css/.js next
    to this module instead of inline, so they can be edited with normal tooling
    and diffed. This pushes them into the single Custom HTML Block record that
    the workspace embeds, then imports the workspace definition itself.

    Re-runnable: both steps overwrite in place, so after editing any guide file
    just run it again --
        bench --site <site> execute afppf_project_management.user_guide.setup.execute
    """
    _sync_block()
    _drop_legacy_workspaces()
    _sync_workspace()
    frappe.db.commit()


def _drop_legacy_workspaces():
    for name in _LEGACY_WORKSPACE_NAMES:
        if frappe.db.exists("Workspace", name):
            frappe.delete_doc("Workspace", name, ignore_permissions=True, force=True)


def _sync_block():
    if frappe.db.exists("Custom HTML Block", BLOCK_NAME):
        doc = frappe.get_doc("Custom HTML Block", BLOCK_NAME)
    else:
        doc = frappe.new_doc("Custom HTML Block")
        doc.name = BLOCK_NAME

    doc.html = _read("guide.html")
    doc.style = _read("guide.css")
    doc.script = _read("guide.js")
    # Shared, not owner-scoped -- every desk user must be able to read it.
    doc.private = 0
    doc.save(ignore_permissions=True)


def _sync_workspace():
    # force=True because the file's `modified` stamp is fixed; without it the
    # importer skips a workspace that already exists at the same timestamp.
    import_file_by_path(_WORKSPACE_FILE, force=True)
