import streamlit as st

from catalog import WoodTypeCatalog
from components.assembly_table import render_assembly_table
from models.wood import Assembly, Project


def format_dimensions(width: float, height: float) -> str:
    """Format dimensions with 1 decimal place"""
    return f"{width:.1f}x{height:.1f}mm"


def calculate_piece_price(length: float, price_per_meter: float) -> float:
    return length * price_per_meter


def render_assembly_builder(catalog: WoodTypeCatalog, project: Project):
    """Render the assembly builder tab"""
    st.header("Assembly Builder")

    # Add new assembly section
    with st.form("new_assembly_form", clear_on_submit=True):
        new_assembly_name = st.text_input("Assembly Name")
        if st.form_submit_button("Add New Assembly"):
            if new_assembly_name:
                project.assemblies.append(Assembly(name=new_assembly_name))
                # Save project after adding assembly
                if (
                    "project_manager" in st.session_state
                    and project.name != "Untitled Project"
                ):
                    st.session_state.project_manager.save_project(project)
                st.success(f"Added new assembly: {new_assembly_name}")
            else:
                st.error("Please enter an assembly name")

    # Display existing assemblies in two columns
    if project.assemblies:
        # Split assemblies into two columns
        col1, col2 = st.columns(2)
        assemblies_left = project.assemblies[::2]  # Even indices
        assemblies_right = project.assemblies[1::2]  # Odd indices

        # Render left column
        with col1:
            for i, assembly in enumerate(assemblies_left):
                if render_assembly_table(assembly, catalog, i * 2, project):
                    break  # Assembly was deleted, break to allow rerender

        # Render right column
        with col2:
            for i, assembly in enumerate(assemblies_right):
                if render_assembly_table(assembly, catalog, i * 2 + 1, project):
                    break  # Assembly was deleted, break to allow rerender
    else:
        st.info("No assemblies yet. Add one using the form above.")
