import pandas as pd
import streamlit as st

from catalog import WoodTypeCatalog
from models.wood import Assembly, AssemblyPiece


def format_dimensions(width: float, height: float) -> str:
    """Format dimensions with 1 decimal place"""
    return f"{width:.1f}x{height:.1f}mm"


def render_assembly_table(
    assembly: Assembly, catalog: WoodTypeCatalog, index: int, project=None
):
    """Render a single assembly table with editable pieces"""

    # Create a unique key for this assembly's data editor
    editor_key = f"assembly_{index}"

    with st.expander(f"📦 {assembly.name}", expanded=True):
        # Convert assembly pieces to table format
        wood_type_options = [
            f"{format_dimensions(wt.width, wt.height)} - {wt.description}"
            for wt in catalog.get_all_wood_types()
        ]

        # Initialize pieces_data with at least one empty row if no pieces exist
        pieces_data = []
        for piece in assembly.pieces:
            wood_type = catalog.get_wood_type(piece.wood_type_index)
            if wood_type:
                pieces_data.append(
                    {
                        "Wood Type": f"{format_dimensions(wood_type.width, wood_type.height)} - {wood_type.description}",
                        "Length (m)": piece.length,
                        "Quantity": piece.quantity,
                        "_wood_type_index": piece.wood_type_index,
                    }
                )

        if not pieces_data:
            pieces_data.append(
                {
                    "Wood Type": wood_type_options[0] if wood_type_options else "",
                    "Length (m)": 0.0,
                    "Quantity": 1,
                    "_wood_type_index": 0,
                }
            )

        # Convert to DataFrame
        df = pd.DataFrame(pieces_data)

        # Create the editable table
        edited_df = st.data_editor(
            df,
            key=editor_key,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "Wood Type": st.column_config.SelectboxColumn(
                    "Wood Type",
                    help="Select the type of wood",
                    width="medium",
                    options=wood_type_options,
                ),
                "Length (m)": st.column_config.NumberColumn(
                    "Length (m)",
                    help="Length in meters",
                    min_value=0.0,
                    step=0.1,
                    format="%.1f",
                    width="small",
                ),
                "Quantity": st.column_config.NumberColumn(
                    "Quantity",
                    help="Number of pieces needed",
                    min_value=1,
                    step=1,
                    format="%d",
                    width="small",
                ),
                "_wood_type_index": None,
            },
            hide_index=True,
        )

        # Handle changes to the table
        if not edited_df.equals(df):
            handle_table_edit(edited_df.to_dict("records"), assembly, catalog)
            # Save project after modifying pieces
            if (
                "project_manager" in st.session_state
                and project
                and project.name != "Untitled Project"
            ):
                st.session_state.project_manager.save_project(project)

        # Add delete button
        col1, col2 = st.columns([0.9, 0.1])
        with col2:
            if st.button("🗑️", key=f"del_{index}", help="Delete assembly"):
                if project and project.assemblies:
                    project.assemblies.remove(assembly)
                    # Save project after deleting assembly
                    if (
                        "project_manager" in st.session_state
                        and project.name != "Untitled Project"
                    ):
                        st.session_state.project_manager.save_project(project)
                    return True
    return False


def handle_table_edit(edited_data: list, assembly: Assembly, catalog: WoodTypeCatalog):
    """Handle edits to the assembly table"""
    if edited_data is None:
        return

    new_pieces = []
    for row in edited_data:
        # Skip empty rows
        if (
            pd.isna(row["Wood Type"])
            or pd.isna(row["Length (m)"])
            or pd.isna(row["Quantity"])
        ):
            continue

        # Find the wood type index from the selection
        wood_type_str = row["Wood Type"]
        wood_type_index = next(
            (
                i
                for i, wt in enumerate(catalog.get_all_wood_types())
                if f"{format_dimensions(wt.width, wt.height)} - {wt.description}"
                == wood_type_str
            ),
            row.get("_wood_type_index", 0),
        )

        new_pieces.append(
            AssemblyPiece(
                wood_type_index=wood_type_index,
                length=float(row["Length (m)"]),
                quantity=int(row["Quantity"]),
            )
        )

    assembly.pieces = new_pieces
