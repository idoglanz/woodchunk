import random
from typing import List

import plotly.express as px
import rectpack

from models.woodboard import BaseWoodBoard, WoodBoard, WoodBoardPiece
from plotting_utils import get_random_color


def verify_wood_pieces(
    woodboard: BaseWoodBoard, wood_pieces: List[WoodBoardPiece]
) -> bool:
    for piece in wood_pieces:
        if not woodboard.contains(piece):
            print(f"Piece {piece} is too large for the woodboard")
            return False
    return True


def solve_woodboard(
    woodboard: BaseWoodBoard, wood_pieces: List[WoodBoardPiece], buffer: float = 0.0
) -> WoodBoard:
    # Normalize, buffer and verify wood pieces
    wood_pieces = [piece.normalize() for piece in wood_pieces]

    if buffer > 0:
        wood_pieces = [piece.buffer(buffer) for piece in wood_pieces]

    if not verify_wood_pieces(woodboard, wood_pieces):
        raise ValueError(
            f"Some wood pieces are too large for the woodboard, make sure pieces are less than {woodboard.width}x{woodboard.length}"
        )

    # Calculate boards needed
    total_area = sum(piece.area for piece in wood_pieces)
    n_boards = total_area / (woodboard.width * woodboard.length) * 2  # 2x for waste
    n_boards = max(1, n_boards)

    # Packer
    packer = rectpack.newPacker(mode=rectpack.PackingMode.Offline, rotation=True)
    for piece in wood_pieces:
        packer.add_rect(piece.width, piece.length, piece.id)
    packer.add_bin(woodboard.length, woodboard.width, n_boards)
    packer.pack()

    # unwind back to wood pieces and woodboards
    piece_map = {piece.id: piece for piece in wood_pieces}
    wood_boards = [
        WoodBoard.from_baseboard(woodboard) for _ in range(len(packer.bin_list()))
    ]

    for rect in packer.rect_list():
        piece = piece_map[rect[5]]
        piece.bottom_left = (rect[1], rect[2])
        piece.width, piece.length = rect[3], rect[4]
        wood_boards[rect[0]].pieces.append(piece)

    return wood_boards


def plot_woodboard(woodboard: WoodBoard):
    # Create shapes for each piece
    shapes = []
    hover_data = []
    annotations = []

    # Add the woodboard background
    shapes.append(
        dict(
            type="rect",
            x0=0,
            y0=0,
            x1=woodboard.length,
            y1=woodboard.width,
            line=dict(width=2, color="black"),
            fillcolor="rgb(240, 230, 210)",  # Light wood color
            opacity=1,
        )
    )

    # Generate colors for pieces
    colors = [get_random_color() for _ in range(len(woodboard.pieces))]

    for i, piece in enumerate(woodboard.pieces):
        if piece.bottom_left is None:
            continue

        x0, y0 = piece.bottom_left
        x1, y1 = x0 + piece.width, y0 + piece.length
        center_x = (x0 + x1) / 2
        center_y = (y0 + y1) / 2

        shapes.append(
            dict(
                type="rect",
                x0=x0,
                y0=y0,
                x1=x1,
                y1=y1,
                line=dict(width=1, color="rgba(50, 50, 50, 0.8)"),
                fillcolor=colors[i],
                opacity=0.7,
            )
        )

        # Add annotation in the center
        label_text = f"{piece.label}<br>" if piece.label else ""
        dimensions = f"{round(piece.width)}×{round(piece.length)}"
        annotations.append(
            dict(
                x=center_x,
                y=center_y,
                text=f"{label_text}{dimensions}",
                showarrow=False,
                font=dict(size=10, color="black"),
                align="center",
                bgcolor="rgba(255, 255, 255, 0.7)",
            )
        )

        # Center point of the piece for hover data
        hover_data.append(
            {
                "x": center_x,
                "y": center_y,
                "width": piece.width,
                "length": piece.length,
                "area": piece.area,
                "label": piece.label or piece.id[:8],
            }
        )

    # Create figure
    fig = px.scatter(
        hover_data,
        x="x",
        y="y",
        hover_data=["width", "length", "area", "label"],
        title=f"Woodboard Layout (Efficiency: {woodboard.efficiency:.1%})",
    )

    # Update layout
    fig.update_layout(
        shapes=shapes,
        annotations=annotations,
        showlegend=False,
        xaxis=dict(
            range=[-5, woodboard.length + 5],  # Add some padding
            title="Length",
            gridcolor="lightgrey",
        ),
        yaxis=dict(
            range=[-5, woodboard.width + 5],  # Add some padding
            title="Width",
            gridcolor="lightgrey",
            scaleanchor="x",  # Make the aspect ratio 1:1
            scaleratio=1,
        ),
        plot_bgcolor="white",
    )

    # Hide the scatter points but keep hover data
    fig.update_traces(marker_color="rgba(0,0,0,0)")
    fig.show()


if __name__ == "__main__":
    import random

    woodboard = BaseWoodBoard(
        width=120, length=240, thickness=10, wood_type="pine", price_per_board=100
    )
    # prepare wood pieces
    wood_pieces = [
        WoodBoardPiece(width=random.randint(10, 100), length=random.randint(10, 100))
        for _ in range(10)
    ]

    # solve
    woodboards = solve_woodboard(woodboard, wood_pieces)
    for woodboard in woodboards:
        plot_woodboard(woodboard)
