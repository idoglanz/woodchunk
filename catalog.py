import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from models.wood import WoodType


class WoodTypeCatalog:
    def __init__(self, file_path: str):
        """Initialize the catalog with a JSON file path."""
        self.file_path = Path(file_path)
        self.wood_types = []
        self._load_catalog()

    def __len__(self):
        return len(self.wood_types)

    def _load_catalog(self):
        """Load the catalog from JSON file. Creates a new one if it doesn't exist."""
        if not self.file_path.exists():
            self._save_catalog()  # Create empty catalog
            return

        with open(self.file_path, "r") as f:
            data = json.load(f).get("wood_types", [])
            self.wood_types = [
                WoodType(
                    width=item["width"],
                    height=item["height"],
                    price_per_meter=item["price_per_meter"],
                    available_lengths=item.get("available_lengths", []),
                    description=item.get("description", ""),
                )
                for item in data
            ]

    def _save_catalog(self):
        """Save the catalog to JSON file."""
        data = {
            "wood_types": [
                {
                    "width": wt.width,
                    "height": wt.height,
                    "price_per_meter": wt.price_per_meter,
                    "available_lengths": wt.available_lengths,
                    "description": wt.description,
                }
                for wt in self.wood_types
            ]
        }
        with open(self.file_path, "w") as f:
            json.dump(data, f, indent=2)

    def update_from_editor(self, edited_rows: Dict[int, Dict[str, Any]]) -> None:
        """Update catalog from edited table rows."""
        for index, row in edited_rows.items():
            # Convert string lengths back to list
            available_lengths = []
            if "Available Lengths" in row:
                try:
                    lengths_str = row["Available Lengths"]
                    available_lengths = [
                        float(x.strip()) for x in lengths_str.split(",") if x.strip()
                    ]
                except:
                    pass  # Keep empty list if parsing fails

            # Create updated wood type
            updated_wood_type = WoodType(
                width=float(row.get("Width (mm)", self.wood_types[index].width)),
                height=float(row.get("Height (mm)", self.wood_types[index].height)),
                price_per_meter=float(
                    row.get("Price/m", self.wood_types[index].price_per_meter).strip(
                        "₪"
                    )
                ),
                available_lengths=available_lengths,
                description=row.get("Description", self.wood_types[index].description),
            )
            self.wood_types[index] = updated_wood_type
        self._save_catalog()

    def add_empty_row(self) -> None:
        """Add an empty row to the catalog."""
        new_wood_type = WoodType(
            width=0.0,
            height=0.0,
            price_per_meter=0.0,
            available_lengths=[],
            description="",
        )
        self.wood_types.append(new_wood_type)
        self._save_catalog()

    def delete_rows(self, rows_to_delete: List[int]) -> None:
        """Delete rows from the catalog."""
        # Sort in reverse order to avoid index shifting
        for index in sorted(rows_to_delete, reverse=True):
            if 0 <= index < len(self.wood_types):
                self.wood_types.pop(index)
        self._save_catalog()

    def to_editable_table(self) -> List[Dict]:
        """Convert the catalog to an editable table format.

        Returns:
            List of dictionaries containing formatted wood type data
        """
        return [
            {
                "Width (mm)": round(wt.width, 1),
                "Height (mm)": round(wt.height, 1),
                "Price/m": f"₪{wt.price_per_meter:.2f}",
                "Available Lengths": ", ".join(map(str, wt.available_lengths)),
                "Description": wt.description,
            }
            for wt in self.wood_types
        ]

    def get_wood_type(self, index: int) -> Optional[WoodType]:
        """Get a wood type by index."""
        if 0 <= index < len(self.wood_types):
            return self.wood_types[index]
        return None

    def get_all_wood_types(self) -> List[WoodType]:
        """Get all wood types in the catalog."""
        return self.wood_types

    def find_wood_types(
        self, width: Optional[float] = None, height: Optional[float] = None
    ) -> List[WoodType]:
        """Find wood types matching the given dimensions."""
        results = self.wood_types
        if width is not None:
            results = [wt for wt in results if wt.width == width]
        if height is not None:
            results = [wt for wt in results if wt.height == height]
        return results

    def to_table(self) -> List[Dict]:
        """Convert the catalog to a table format suitable for display.

        Returns:
            List of dictionaries containing formatted wood type data
        """
        return [
            {
                "Width (mm)": round(wt.width, 1),
                "Height (mm)": round(wt.height, 1),
                "Price/m": f"₪{wt.price_per_meter:.2f}",
                "Available Lengths": ", ".join(map(str, wt.available_lengths)),
                "Description": wt.description,
            }
            for wt in self.wood_types
        ]
