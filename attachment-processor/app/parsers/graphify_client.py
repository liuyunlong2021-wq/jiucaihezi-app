"""Internal client for the existing 8090 Graphify service.

⚠️  GRAPHIFY IS NOT AVAILABLE on the current production server (2026-06-20).
The graphify Python module is not installed in the 8090 service:
  POST /api/graphify/build → {"status":"error","stderr":"No module named graphify"}

This module is kept as a stub for future use. Do NOT include graphify
in the main attachment parse chain or acceptance criteria.

If graphify is installed later:
  POST /api/graphify/build → accepts files + backend + api_key
  POST /api/graphify/query → accepts question + graph_file
"""


def check_graphify_health() -> bool:
    """Graphify is not installed on the current server. Always returns False."""
    return False
