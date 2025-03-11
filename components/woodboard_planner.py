from uuid import uuid4

import streamlit as st

from components.woodboard_list import render_woodboard_list
from models.woodboard import BaseWoodBoard
from repositories.catalog import WoodCatalog


def render_woodboard_planner(catalog: WoodCatalog):
    st.header("📏 Woodboard Planner")

    # Initialize session state for woodboards if not exists
    if "woodboards" not in st.session_state:
        st.session_state.woodboards = []
    if "selected_wood_type" not in st.session_state:
        st.session_state.selected_wood_type = None

    # Add new woodboard section
    with st.container():
        st.subheader("Add New Woodboard")

        # Get available wood types from catalog
        available_boards = catalog.get_all_woodboards()
        wood_type_options = list(
            set(board.wood_type.value for board in available_boards)
        )

        # Create a container for the woodboard inputs
        with st.container():
            col1, col2, col3 = st.columns([2, 1, 1])

            with col1:
                # Wood type selection with on_change callback
                selected_type = st.selectbox(
                    "Wood Type",
                    options=wood_type_options,
                    key="new_board_type",
                    index=wood_type_options.index(st.session_state.selected_wood_type)
                    if st.session_state.selected_wood_type in wood_type_options
                    else 0,
                    on_change=lambda: setattr(
                        st.session_state,
                        "selected_wood_type",
                        st.session_state.new_board_type,
                    ),
                )

            with col2:
                # Get available thicknesses for selected wood type
                thickness_options = list(
                    set(
                        board.thickness
                        for board in available_boards
                        if board.wood_type.value == selected_type
                    )
                )
                thickness = st.selectbox(
                    "Thickness (mm)",
                    options=thickness_options,
                    key="new_board_thickness",
                )
            with col3:
                # Get price from catalog for selected wood type and thickness
                matching_board = next(
                    (
                        board
                        for board in available_boards
                        if board.wood_type.value == selected_type
                        and board.thickness == thickness
                    ),
                    None,
                )
                price = st.number_input(
                    "Price per Board",
                    value=int(matching_board.price_per_board) if matching_board else 0,
                    min_value=0,
                    key="new_board_price",
                )

            # Add button outside the columns
            if st.button("Add Woodboard", use_container_width=True):
                new_board = {
                    "id": str(uuid4()),
                    "base_board": BaseWoodBoard(
                        width=120,
                        length=240,
                        thickness=thickness,
                        wood_type=selected_type,
                        price_per_board=price,
                    ),
                    "pieces": [],
                    "temp_df": None,  # Store temporary changes
                    "result_boards": None,  # Store the last planning result
                }
                st.session_state.woodboards.append(new_board)
                st.success("Woodboard added successfully!")

    # Display existing woodboards using the new component
    if st.session_state.woodboards:
        st.markdown("---")
        st.subheader("Woodboard List")
        render_woodboard_list(st.session_state.woodboards)
