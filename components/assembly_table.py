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
        units = st.number_input(
            "Number of units",
            min_value=1,
            value=assembly.units,
            key=f"units_{index}",
            help="Number of times this assembly is needed",
        )
        # Initialize pieces_data with at least one empty row if no pieces exist
        pieces_data = []
        for piece in assembly.pieces:
            wood_type = catalog.get_wood_type(piece.wood_type_index)
            if wood_type:
                pieces_data.append(
                    {
                        "Wood Type": f"{format_dimensions(wood_type.width, wood_type.height)} - {wood_type.description}",
                        "Length (cm)": piece.length * 100,  # Convert to cm for display
                        "Quantity": piece.quantity,
                        "_wood_type_index": piece.wood_type_index,
                    }
                )

        if not pieces_data:
            pieces_data.append(
                {
                    "Wood Type": wood_type_options[0] if wood_type_options else "",
                    "Length (cm)": 0.0,
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
                "Length (cm)": st.column_config.NumberColumn(
                    "Length (cm)",
                    help="Length in centimeters",
                    min_value=0.0,
                    step=1.0,
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

        # Add save, units, and delete buttons in a row
        _, col3, col4 = st.columns([0.8, 0.1, 0.1])
        
        if col3.button("💾", key=f"save_{index}", help="Save changes"):
            # Convert the edited DataFrame back to meters before saving
            edited_df["Length (cm)"] = edited_df["Length (cm)"].astype(float)
            edited_df_meters = edited_df.copy()
            edited_df_meters["Length (m)"] = edited_df["Length (cm)"] / 100
            handle_table_edit(edited_df_meters.to_dict("records"), assembly, catalog)
            assembly.units = units  # Save the units value
            # Save project after modifying pieces
            if (
                "project_manager" in st.session_state
                and project
                and project.name != "Untitled Project"
            ):
                st.session_state.project_manager.save_project(project)
                st.success("Changes saved!")

        if col4.button("🗑️", key=f"del_{index}", help="Delete assembly"):
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
    if not edited_data:
        return

    new_pieces = []
    for row in edited_data:
        # Skip empty rows or non-dict rows
        if not isinstance(row, dict):
            continue
            
        # Get the values, with proper type handling
        wood_type = row.get("Wood Type")
        length = row.get("Length (m)")  # Now getting length in meters
        quantity = row.get("Quantity")
        
        if not all(x is not None for x in [wood_type, length, quantity]):
            continue

        # Find the wood type index from the selection
        wood_type_str = str(wood_type)
        wood_types = catalog.get_all_wood_types()
        
        # Try to find the matching wood type
        wood_type_index = None
        for i, wt in enumerate(wood_types):
            formatted = f"{format_dimensions(wt.width, wt.height)} - {wt.description}"
            if formatted == wood_type_str:
                wood_type_index = i
                break
        
        # If no match found, keep the existing wood type index
        if wood_type_index is None:
            wood_type_index = row.get("_wood_type_index", 0)

        try:
            new_pieces.append(
                AssemblyPiece(
                    wood_type_index=wood_type_index,
                    length=float(length),  # Length is already in meters
                    quantity=int(quantity),
                )
            )
        except (ValueError, TypeError):
            continue  # Skip invalid entries

    assembly.pieces = new_pieces
