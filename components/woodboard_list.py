import pandas as pd
import streamlit as st

from models.woodboard import WoodBoardPiece
from woodboard_solver import plot_woodboard, solve_woodboard


def render_woodboard_list(woodboards):
    """Render the list of existing woodboards with their pieces and planning options."""
    for board_idx, board in enumerate(woodboards):
        with st.expander(
            f"**Woodboard {board_idx + 1}: {board['base_board'].wood_type} ({board['base_board'].thickness}mm)**",
            expanded=True,
        ):
            # Create a DataFrame for the pieces
            if board["temp_df"] is None:
                # Initialize with a sample piece if no pieces exist
                if len(board["pieces"]) == 0:
                    df = pd.DataFrame(
                        [
                            {
                                "Label": "Sample Piece",
                                "Width (cm)": 15,
                                "Length (cm)": 15,
                                "Quantity": 1,
                            }
                        ]
                    )
                else:
                    df = pd.DataFrame(
                        [
                            {
                                "Label": piece.label or "",
                                "Width (cm)": piece.width,
                                "Length (cm)": piece.length,
                                "Quantity": piece.quantity
                                if hasattr(piece, "quantity")
                                else 1,
                            }
                            for piece in board["pieces"]
                        ]
                    )
                board["temp_df"] = df

            # Edit the DataFrame
            edited_df = st.data_editor(
                board["temp_df"],
                num_rows="dynamic",
                use_container_width=True,
                column_config={
                    "Label": st.column_config.TextColumn(
                        "Label", help="Optional label for the piece", default=""
                    ),
                    "Width (cm)": st.column_config.NumberColumn(
                        "Width (cm)",
                        help="Width in centimeters",
                        min_value=1,
                        max_value=board["base_board"].width,
                        default=15,
                    ),
                    "Length (cm)": st.column_config.NumberColumn(
                        "Length (cm)",
                        help="Length in centimeters",
                        min_value=1,
                        max_value=board["base_board"].length,
                        default=15,
                    ),
                    "Quantity": st.column_config.NumberColumn(
                        "Quantity",
                        help="Number of pieces needed",
                        min_value=1,
                        default=1,
                        step=1,
                    ),
                },
            )

            # Action buttons
            col1, col2 = st.columns(2)

            if col1.button(
                "💾 Save & Plan",
                key=f"save_{board['id']}",
                use_container_width=True,
            ):
                # Update pieces from edited DataFrame
                board["pieces"] = [
                    WoodBoardPiece(
                        label=row["Label"] if pd.notna(row["Label"]) else None,
                        width=row["Width (cm)"],
                        length=row["Length (cm)"],
                        quantity=row["Quantity"],
                    )
                    for _, row in edited_df.iterrows()
                ]
                board["temp_df"] = edited_df

                # Run the planner
                if len(board["pieces"]) > 0:
                    try:
                        board["result_boards"] = solve_woodboard(
                            board["base_board"], board["pieces"]
                        )
                        st.success(
                            f"Changes saved! Successfully planned {len(board['result_boards'])} boards!"
                        )
                    except Exception as e:
                        st.error(f"Error planning woodboard: {str(e)}")
                else:
                    st.success("Changes saved!")

            if col2.button(
                "🗑️ Delete Board",
                key=f"delete_{board['id']}",
                use_container_width=True,
            ):
                woodboards.pop(board_idx)
                st.rerun()

            # Display the plots if they exist
            if board["result_boards"]:
                st.markdown("### Cutting Layout")
                for idx, result_board in enumerate(board["result_boards"]):
                    st.markdown(f"#### Board {idx + 1}")
                    figure = plot_woodboard(result_board)
                    st.plotly_chart(figure)
