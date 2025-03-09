from uuid import uuid4

import pandas as pd
import streamlit as st

from models.woodboard import BaseWoodBoard, WoodBoardPiece
from woodboard_solver import plot_woodboard, solve_woodboard


def render_woodboard_planner():
    st.header("📏 Woodboard Planner")

    # Initialize session state for woodboards if not exists
    if "woodboards" not in st.session_state:
        st.session_state.woodboards = []

    # Add new woodboard section
    with st.container():
        st.subheader("Add New Woodboard")
        col1, col2, col3, col4 = st.columns([2, 1, 1, 1])

        with col1:
            wood_type = st.text_input("Wood Type", value="pine", key="new_board_type")
        with col2:
            thickness = st.number_input(
                "Thickness (mm)", value=10, min_value=1, key="new_board_thickness"
            )
        with col3:
            price = st.number_input(
                "Price per Board", value=100, min_value=0, key="new_board_price"
            )
        with col4:
            if st.button("Add Woodboard", use_container_width=True):
                new_board = {
                    "id": str(uuid4()),
                    "base_board": BaseWoodBoard(
                        width=120,
                        length=240,
                        thickness=thickness,
                        wood_type=wood_type,
                        price_per_board=price,
                    ),
                    "pieces": [],
                    "temp_df": None,  # Store temporary changes
                    "result_boards": None,  # Store the last planning result
                }
                st.session_state.woodboards.append(new_board)

    # Display existing woodboards
    for board_idx, board in enumerate(st.session_state.woodboards):
        with st.expander(
            f"Woodboard {board_idx + 1}: {board['base_board'].wood_type} ({board['base_board'].thickness}mm)",
            expanded=True,
        ):
            # Create a DataFrame for the pieces
            if board["temp_df"] is None:
                if len(board["pieces"]) > 0:
                    df = pd.DataFrame(
                        [
                            {
                                "Label": piece.label or "",
                                "Width (cm)": piece.width,
                                "Length (cm)": piece.length,
                            }
                            for piece in board["pieces"]
                        ]
                    )
                else:
                    df = pd.DataFrame(columns=["Label", "Width (cm)", "Length (cm)"])
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
                        default=30,
                    ),
                    "Length (cm)": st.column_config.NumberColumn(
                        "Length (cm)",
                        help="Length in centimeters",
                        min_value=1,
                        max_value=board["base_board"].length,
                        default=30,
                    ),
                },
            )
            board["temp_df"] = edited_df

            # Action buttons
            col1, col2, col3 = st.columns(3)
            with col1:
                if st.button(
                    "🎯 Run Planner", key=f"run_{board['id']}", use_container_width=True
                ):
                    if len(board["pieces"]) > 0:
                        try:
                            board["result_boards"] = solve_woodboard(
                                board["base_board"], board["pieces"]
                            )
                            st.success(
                                f"Successfully planned {len(board['result_boards'])} boards!"
                            )
                        except Exception as e:
                            st.error(f"Error planning woodboard: {str(e)}")
                    else:
                        st.warning("Please add some pieces first!")

            with col2:
                if st.button(
                    "🗑️ Delete Board",
                    key=f"delete_{board['id']}",
                    use_container_width=True,
                ):
                    st.session_state.woodboards.pop(board_idx)
                    st.rerun()

            with col3:
                if st.button(
                    "💾 Save Changes",
                    key=f"save_{board['id']}",
                    use_container_width=True,
                ):
                    # Update pieces from edited DataFrame
                    board["pieces"] = [
                        WoodBoardPiece(
                            label=row["Label"] if pd.notna(row["Label"]) else None,
                            width=row["Width (cm)"],
                            length=row["Length (cm)"],
                        )
                        for _, row in edited_df.iterrows()
                    ]

                    # Run the planner automatically on save if there are pieces
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

            # Display the plots if they exist
            if board["result_boards"]:
                st.markdown("### Cutting Layout")
                for idx, result_board in enumerate(board["result_boards"]):
                    st.markdown(f"#### Board {idx + 1}")
                    plot_woodboard(result_board)
