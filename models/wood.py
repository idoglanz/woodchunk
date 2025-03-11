from typing import List, Optional

from pydantic import BaseModel


class Lumber(BaseModel):
    width: float
    height: float
    price_per_meter: float
    available_lengths: List[float] = []
    description: str = ""


class AssemblyPiece(BaseModel):
    lumber_index: int  # Index in the catalog
    length: float
    quantity: int = 1


class Assembly(BaseModel):
    name: str
    pieces: List[AssemblyPiece] = []
    units: int = 1  # Default to 1 unit


class Project(BaseModel):
    name: str
    assemblies: List[Assembly] = []
    description: str = ""


class WoodPiece(Lumber):
    length: float
    total_price: float


class CutList(BaseModel):
    """a 'pivot' of the wood pieces to the lumber type"""

    lumber: Lumber
    total_price: float
    total_length: float


class WoodAssembly(BaseModel):
    wood_pieces: list[WoodPiece]
    cut_list: list[CutList]
    total_price: float
