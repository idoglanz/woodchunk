from enum import Enum
from typing import List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class WoodType(str, Enum):
    PINE = "pine"
    BIRCH = "birch"
    SANDWICH = "sandwich"
    LAMINATE = "laminate"


class WoodBoardPiece(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    width: float
    length: float
    bottom_left: Optional[tuple[float, float]] = None
    label: Optional[str] = None
    quantity: int = 1

    @property
    def area(self) -> float:
        return self.width * self.length

    def normalize(self) -> None:
        self.width, self.length = min(self.width, self.length), max(
            self.width, self.length
        )

    def buffer(self, buffer: float) -> None:
        self.width += buffer
        self.length += buffer


class BaseWoodBoard(BaseModel):
    width: float
    length: float
    thickness: float
    wood_type: WoodType = WoodType.PINE
    price_per_board: float

    def contains(self, piece: WoodBoardPiece) -> bool:
        piece.normalize()
        return self.width >= piece.width and self.length >= piece.length


class WoodBoard(BaseWoodBoard):
    pieces: List[WoodBoardPiece]

    @classmethod
    def from_baseboard(
        cls, baseboard: BaseWoodBoard, pieces: List[WoodBoardPiece] = []
    ) -> "WoodBoard":
        return cls(**baseboard.model_dump(), pieces=pieces)

    @property
    def used_area(self) -> float:
        return sum(piece.area for piece in self.pieces)

    @property
    def efficiency(self) -> float:
        return self.used_area / (self.width * self.length)


if __name__ == "__main__":
    woodboard = BaseWoodBoard(
        width=120, length=240, thickness=10, wood_type="pine", price_per_board=100
    )
    piece = WoodBoardPiece(width=120, length=10)
    piece.normalize()
    print(piece)
    print(woodboard.contains(piece))
