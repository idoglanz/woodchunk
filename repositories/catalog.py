import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from models.wood import Lumber
from models.woodboard import BaseWoodBoard
from models.woodboard import WoodType as BoardWoodType


class WoodCatalog:
    def __init__(self, file_path: str):
        """Initialize the catalog with a JSON file path."""
        self.file_path = Path(file_path)
        self.lumber_types = []
        self.woodboards = []
        self._load_catalog()

    def __len__(self):
        return len(self.lumber_types) + len(self.woodboards)

    def _load_catalog(self):
        """Load the catalog from JSON file. Creates a new one if it doesn't exist."""
        if not self.file_path.exists():
            self._save_catalog()  # Create empty catalog
            return

        with open(self.file_path, "r") as f:
            data = json.load(f)
            # Load lumber types
            lumber_data = data.get("lumber_types", [])
            self.lumber_types = [
                Lumber(
                    width=item["width"],
                    height=item["height"],
                    price_per_meter=item["price_per_meter"],
                    available_lengths=item.get("available_lengths", []),
                    description=item.get("description", ""),
                )
                for item in lumber_data
            ]

            # Load woodboards
            woodboards_data = data.get("woodboards", [])
            self.woodboards = [
                BaseWoodBoard(
                    width=item["width"],
                    length=item["length"],
                    thickness=item["thickness"],
                    wood_type=item["wood_type"],
                    price_per_board=item["price_per_board"],
                )
                for item in woodboards_data
            ]

    def _save_catalog(self):
        """Save the catalog to JSON file."""
        data = {
            "lumber_types": [
                {
                    "width": wt.width,
                    "height": wt.height,
                    "price_per_meter": wt.price_per_meter,
                    "available_lengths": wt.available_lengths,
                    "description": wt.description,
                }
                for wt in self.lumber_types
            ],
            "woodboards": [
                {
                    "width": wb.width,
                    "length": wb.length,
                    "thickness": wb.thickness,
                    "wood_type": wb.wood_type,
                    "price_per_board": wb.price_per_board,
                }
                for wb in self.woodboards
            ],
        }
        with open(self.file_path, "w") as f:
            json.dump(data, f, indent=2)

    def update_from_editor(
        self, edited_rows: Dict[int, Dict[str, Any]], is_woodboard: bool = False
    ) -> None:
        """Update catalog from edited table rows."""
        items = self.woodboards if is_woodboard else self.lumber_types
        for index, row in edited_rows.items():
            if is_woodboard:
                updated_item = BaseWoodBoard(
                    width=float(row.get("Width (mm)", items[index].width)),
                    length=float(row.get("Length (mm)", items[index].length)),
                    thickness=float(row.get("Thickness (mm)", items[index].thickness)),
                    wood_type=row.get("Wood Type", items[index].wood_type),
                    price_per_board=float(
                        row.get("Price/Board", items[index].price_per_board).strip("₪")
                    ),
                )
            else:
                # Convert string lengths back to list
                available_lengths = []
                if "Available Lengths" in row:
                    try:
                        lengths_str = row["Available Lengths"]
                        available_lengths = [
                            float(x.strip())
                            for x in lengths_str.split(",")
                            if x.strip()
                        ]
                    except:
                        pass  # Keep empty list if parsing fails

                updated_item = Lumber(
                    width=float(row.get("Width (mm)", items[index].width)),
                    height=float(row.get("Height (mm)", items[index].height)),
                    price_per_meter=float(
                        row.get("Price/m", items[index].price_per_meter).strip("₪")
                    ),
                    available_lengths=available_lengths,
                    description=row.get("Description", items[index].description),
                )
            items[index] = updated_item
        self._save_catalog()

    def add_empty_row(self, is_woodboard: bool = False) -> None:
        """Add an empty row to the catalog."""
        if is_woodboard:
            new_board = BaseWoodBoard(
                width=0.0,
                length=0.0,
                thickness=0.0,
                wood_type=BoardWoodType.PINE,
                price_per_board=0.0,
            )
            self.woodboards.append(new_board)
        else:
            new_lumber = Lumber(
                width=0.0,
                height=0.0,
                price_per_meter=0.0,
                available_lengths=[],
                description="",
            )
            self.lumber_types.append(new_lumber)
        self._save_catalog()

    def delete_rows(
        self, rows_to_delete: List[int], is_woodboard: bool = False
    ) -> None:
        """Delete rows from the catalog."""
        items = self.woodboards if is_woodboard else self.lumber_types
        # Sort in reverse order to avoid index shifting
        for index in sorted(rows_to_delete, reverse=True):
            if 0 <= index < len(items):
                items.pop(index)
        self._save_catalog()

    def to_dict_list(self, is_woodboard: bool = False) -> List[Dict]:
        """Convert the catalog to an editable table format."""
        items = self.woodboards if is_woodboard else self.lumber_types
        if is_woodboard:
            return [
                {
                    "Width (mm)": round(wb.width, 1),
                    "Length (mm)": round(wb.length, 1),
                    "Thickness (mm)": round(wb.thickness, 1),
                    "Wood Type": wb.wood_type,
                    "Price/Board": f"₪{wb.price_per_board:.2f}",
                }
                for wb in items
            ]
        else:
            return [
                {
                    "Width (mm)": round(wt.width, 1),
                    "Height (mm)": round(wt.height, 1),
                    "Price/m": f"₪{wt.price_per_meter:.2f}",
                    "Available Lengths": ", ".join(map(str, wt.available_lengths)),
                    "Description": wt.description,
                }
                for wt in items
            ]

    def get_lumber(self, index: int) -> Optional[Lumber]:
        """Get a lumber type by index."""
        if 0 <= index < len(self.lumber_types):
            return self.lumber_types[index]
        return None

    def get_woodboard(self, index: int) -> Optional[BaseWoodBoard]:
        """Get a woodboard by index."""
        if 0 <= index < len(self.woodboards):
            return self.woodboards[index]
        return None

    def get_all_lumber(self) -> List[Lumber]:
        """Get all lumber types in the catalog."""
        return self.lumber_types

    def get_all_woodboards(self) -> List[BaseWoodBoard]:
        """Get all woodboards in the catalog."""
        return self.woodboards

    def find_lumber(
        self, width: Optional[float] = None, height: Optional[float] = None
    ) -> List[Lumber]:
        """Find lumber types matching the given dimensions."""
        results = self.lumber_types
        if width is not None:
            results = [wt for wt in results if wt.width == width]
        if height is not None:
            results = [wt for wt in results if wt.height == height]
        return results

    def find_woodboards(
        self,
        width: Optional[float] = None,
        length: Optional[float] = None,
        thickness: Optional[float] = None,
    ) -> List[BaseWoodBoard]:
        """Find woodboards matching the given dimensions."""
        results = self.woodboards
        if width is not None:
            results = [wb for wb in results if wb.width == width]
        if length is not None:
            results = [wb for wb in results if wb.length == length]
        if thickness is not None:
            results = [wb for wb in results if wb.thickness == thickness]
        return results

    def to_table(self) -> List[Dict]:
        """Convert the catalog to a table format suitable for display.

        Returns:
            List of dictionaries containing formatted lumber data
        """
        return [
            {
                "Width (mm)": round(wt.width, 1),
                "Height (mm)": round(wt.height, 1),
                "Price/m": f"₪{wt.price_per_meter:.2f}",
                "Available Lengths": ", ".join(map(str, wt.available_lengths)),
                "Description": wt.description,
            }
            for wt in self.lumber_types
        ]
