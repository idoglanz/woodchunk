import streamlit as st
from catalog import WoodTypeCatalog

def render_catalog_management(catalog: WoodTypeCatalog):
    """Render the wood catalog management tab"""
    st.header("Wood Catalog Management")
    
    # Initialize the editor key in session state if not present
    if "editor_key" not in st.session_state:
        st.session_state.editor_key = 0

    # Get current catalog data
    catalog_data = catalog.to_editable_table()
    
    # Create the editable table
    edited_data = st.data_editor(
        catalog_data,
        key=f"catalog_editor_{st.session_state.editor_key}",
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "Width (mm)": st.column_config.NumberColumn(
                help="Width in millimeters",
                min_value=0.0,
                step=0.1,
                format="%.1f"
            ),
            "Height (mm)": st.column_config.NumberColumn(
                help="Height in millimeters",
                min_value=0.0,
                step=0.1,
                format="%.1f"
            ),
            "Price/m (₪)": st.column_config.NumberColumn(
                help="Price per meter in ils",
                min_value=0.0,
                step=0.1,
                format="%.2f"
            ),
            "Available Lengths": st.column_config.TextColumn(
                help="Comma-separated list of available lengths in meters"
            ),
            "Description": st.column_config.TextColumn(
                help="Description of the wood type"
            ),
        },
        hide_index=True,
    )

    # Handle any changes to the data
    if edited_data is not None:
        handle_table_edit(edited_data, catalog)

def handle_table_edit(edited_data, catalog: WoodTypeCatalog):
    """Handle edits to the catalog table"""
    if len(edited_data) != len(catalog):
        # Handle row deletion or addition
        current_count = len(catalog)
        edited_count = len(edited_data)
        if edited_count < current_count:
            # Find deleted rows
            deleted_indices = []
            for i in range(current_count):
                if i >= edited_count or edited_data[i] != catalog.to_editable_table()[i]:
                    deleted_indices.append(i)
            catalog.delete_rows(deleted_indices)
            st.session_state.editor_key += 1
            st.rerun()
        elif edited_count > current_count:
            # Handle row addition
            catalog.add_empty_row()
            st.session_state.editor_key += 1
            st.rerun()
    else:
        # Handle row edits
        edited_rows = {}
        for i, row in enumerate(edited_data):
            if row != catalog.to_editable_table()[i]:
                edited_rows[i] = row
        if edited_rows:
            catalog.update_from_editor(edited_rows)
            st.session_state.editor_key += 1
            st.rerun()
