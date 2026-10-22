"""Write the OpenAPI schema for the frontend type generator.

    uv run python -m scripts.export_openapi ../frontend/openapi.json
"""

import json
import sys

from app.main import app

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "openapi.json"
    with open(out, "w") as f:
        json.dump(app.openapi(), f, indent=1)
    print(f"wrote {out}")
