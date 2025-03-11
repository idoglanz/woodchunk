import streamlit as st

from repositories.catalog import WoodCatalog


def render_catalog_management(catalog: WoodCatalog):
    """Render the wood catalog management tab"""
    st.header("Wood Catalog Management")

    # Create tabs for lumber and woodboards
    lumber_tab, woodboards_tab = st.tabs(["Lumber", "Woodboards"])

    with lumber_tab:
        render_lumber_editor(catalog)

    with woodboards_tab:
        render_woodboards_editor(catalog)


def render_lumber_editor(catalog: WoodCatalog):
    """Render the lumber editor"""
    st.subheader("Lumber")

    # Initialize the editor key in session state if not present
    if "lumber_editor_key" not in st.session_state:
        st.session_state.lumber_editor_key = 0

    # Get current catalog data
    catalog_data = catalog.to_dict_list(is_woodboard=False)

    # Create the editable table
    edited_data = st.data_editor(
        catalog_data,
        key=f"lumber_editor_{st.session_state.lumber_editor_key}",
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "Width (mm)": st.column_config.NumberColumn(
                help="Width in millimeters", min_value=0.0, step=0.1, format="%.1f"
            ),
            "Height (mm)": st.column_config.NumberColumn(
                help="Height in millimeters", min_value=0.0, step=0.1, format="%.1f"
            ),
            "Price/m": st.column_config.NumberColumn(
                help="Price per meter in ils", min_value=0.0, step=0.1, format="%.2f"
            ),
            "Available Lengths": st.column_config.TextColumn(
                help="Comma-separated list of available lengths in meters"
            ),
            "Description": st.column_config.TextColumn(
                help="Description of the lumber type"
            ),
        },
        hide_index=True,
    )

    # Handle any changes to the data
    if edited_data is not None:
        handle_table_edit(edited_data, catalog, is_woodboard=False)


def render_woodboards_editor(catalog: WoodCatalog):
    """Render the woodboards editor"""
    st.subheader("Woodboards")

    # Initialize the editor key in session state if not present
    if "woodboards_editor_key" not in st.session_state:
        st.session_state.woodboards_editor_key = 0

    # Get current catalog data
    catalog_data = catalog.to_dict_list(is_woodboard=True)

    # Create the editable table
    edited_data = st.data_editor(
        catalog_data,
        key=f"woodboards_editor_{st.session_state.woodboards_editor_key}",
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "Width (mm)": st.column_config.NumberColumn(
                help="Width in millimeters", min_value=0.0, step=0.1, format="%.1f"
            ),
            "Length (mm)": st.column_config.NumberColumn(
                help="Length in millimeters", min_value=0.0, step=0.1, format="%.1f"
            ),
            "Thickness (mm)": st.column_config.NumberColumn(
                help="Thickness in millimeters", min_value=0.0, step=0.1, format="%.1f"
            ),
            "Wood Type": st.column_config.SelectboxColumn(
                help="Type of wood",
                options=["pine", "birch", "sandwich", "laminate"],
            ),
            "Price/Board": st.column_config.NumberColumn(
                help="Price per board in ils", min_value=0.0, step=0.1, format="%.2f"
            ),
        },
        hide_index=True,
    )

    # Handle any changes to the data
    if edited_data is not None:
        handle_table_edit(edited_data, catalog, is_woodboard=True)


def handle_table_edit(edited_data, catalog: WoodCatalog, is_woodboard: bool):
    """Handle edits to the catalog table"""
    current_items = catalog.woodboards if is_woodboard else catalog.lumber_types
    current_count = len(current_items)
    edited_count = len(edited_data)

    if edited_count < current_count:
        # Find deleted rows
        deleted_indices = []
        for i in range(current_count):
            if (
                i >= edited_count
                or edited_data[i] != catalog.to_dict_list(is_woodboard=is_woodboard)[i]
            ):
                deleted_indices.append(i)
        catalog.delete_rows(deleted_indices, is_woodboard=is_woodboard)
        if is_woodboard:
            st.session_state.woodboards_editor_key += 1
        else:
            st.session_state.lumber_editor_key += 1
        st.rerun()
    elif edited_count > current_count:
        # Handle row addition
        catalog.add_empty_row(is_woodboard=is_woodboard)
        if is_woodboard:
            st.session_state.woodboards_editor_key += 1
        else:
            st.session_state.lumber_editor_key += 1
        st.rerun()
    else:
        # Handle row edits
        edited_rows = {}
        for i, row in enumerate(edited_data):
            if row != catalog.to_dict_list(is_woodboard=is_woodboard)[i]:
                edited_rows[i] = row
        if edited_rows:
            catalog.update_from_editor(edited_rows, is_woodboard=is_woodboard)
            if is_woodboard:
                st.session_state.woodboards_editor_key += 1
            else:
                st.session_state.lumber_editor_key += 1
            st.rerun()
