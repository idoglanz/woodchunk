import base64
from pathlib import Path

import streamlit as st

from catalog import WoodTypeCatalog
from components.assembly_builder import render_assembly_builder
from components.catalog_view import render_catalog_management
from components.cutlist_viewer import render_cut_list
from components.new_project import new_project_dialog
from models.wood import Project
from project_manager import ProjectManager


# Load custom CSS
def load_css():
    css_file = Path("static/css/style.css")
    if css_file.exists():
        with open(css_file) as f:
            st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)


# Configure page settings
st.set_page_config(
    page_title="🪵 WoodChunk",
    page_icon="🪵",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Load custom CSS
load_css()


def calculate_project_stats(project: Project):
    """Calculate basic stats for the project"""
    total_assemblies = len(project.assemblies)
    total_pieces = sum(len(assembly.pieces) for assembly in project.assemblies)
    total_unique_pieces = sum(
        1 for assembly in project.assemblies for piece in assembly.pieces
    )
    return {
        "Total Assemblies": total_assemblies,
        "Total Pieces": total_pieces,
        "Unique Pieces": total_unique_pieces,
    }


def main():
    # Initialize catalog and session state
    if "catalog" not in st.session_state:
        st.session_state.catalog = WoodTypeCatalog("sample_catalog.json")
    if "project_manager" not in st.session_state:
        st.session_state.project_manager = ProjectManager()
    if "current_project" not in st.session_state:
        st.session_state.current_project = Project(name="Untitled Project")
    if "show_new_project_dialog" not in st.session_state:
        st.session_state.show_new_project_dialog = False

    # Project management section
    with st.sidebar:
        st.markdown(
            """
            <div style='text-align: center; margin-bottom: 20px;'>
                <h1 style='color: white;'>🪵 WoodChunk</h1>
                <p style='color: #DEB887;'>Your Woodworking Assistant</p>
            </div>
        """,
            unsafe_allow_html=True,
        )

        st.markdown(
            "<h3 style='color: white;'>📁 Project Manager</h3>", unsafe_allow_html=True
        )

        # Project selection
        available_projects = st.session_state.project_manager.get_available_projects()
        if not available_projects:
            st.info("✨ No projects yet. Create your first project!")
        else:
            selected_project = st.selectbox(
                "Select Project",
                options=available_projects,
                index=available_projects.index(st.session_state.current_project.name)
                if st.session_state.current_project.name in available_projects
                else 0,
            )

            # Handle project selection
            if selected_project != st.session_state.current_project.name:
                st.session_state.current_project = (
                    st.session_state.project_manager.load_project(selected_project)
                )

        # New project button
        if st.button("➕ Create New Project", use_container_width=True):
            new_project_dialog()

        # Project Stats
        if st.session_state.current_project.name != "Untitled Project":
            st.markdown("---")
            st.markdown(
                "<h3 style='color: white;'>📊 Project Stats</h3>", unsafe_allow_html=True
            )
            stats = calculate_project_stats(st.session_state.current_project)

            # Display stats in columns with custom styling
            stat_cols = st.columns(len(stats))
            for col, (label, value) in zip(stat_cols, stats.items()):
                with col:
                    st.markdown(
                        f"""
                        <div style='background-color: rgba(255,255,255,0.1); padding: 10px; border-radius: 5px; text-align: center;'>
                            <p style='color: #DEB887; margin: 0;'>{label}</p>
                            <h2 style='color: white; margin: 5px 0;'>{value}</h2>
                        </div>
                    """,
                        unsafe_allow_html=True,
                    )

            # Save button
            st.markdown("---")
            if st.button("💾 Save Project", use_container_width=True):
                st.session_state.project_manager.save_project(
                    st.session_state.current_project
                )
                st.success(
                    f"Project '{st.session_state.current_project.name}' saved successfully!"
                )

    # Main content area
    st.markdown(
        f"""
        <h1 style='text-align: center; color: #8B4513; margin-bottom: 30px;'>
            Project: {st.session_state.current_project.name}
        </h1>
    """,
        unsafe_allow_html=True,
    )

    # Main tabs with custom styling
    tab1, tab2, tab3, tab4 = st.tabs(
        [
            "👋 Welcome Guide",
            "🔨 Assembly Builder",
            "📊 Cut List Summary",
            "📋 Catalog Management",
        ]
    )

    with tab1:
        st.header("Welcome to WoodChunk! 🪵")

        st.markdown(
            """
        This app helps you plan your woodworking projects by managing your wood inventory,
        designing assemblies, and generating detailed cut lists.

        ### 📝 Basic Concepts
        - **Project**: A collection of assemblies (e.g., a table project might include table top, legs, and supports)
        - **Assembly**: A group of wood pieces that form a component (e.g., table top)
        - **Units**: How many copies of an assembly you need (e.g., 4 chair legs)
        - **Wood Type**: A specific wood dimension and type from your catalog

        ### 🚀 Getting Started
        1. First, go to the **Catalog Management** tab to:
           - Add your available wood types
           - Specify dimensions, prices, and available lengths
           - Add descriptions to help identify wood types

        2. Create a new project using the **Create New Project** button in the sidebar

        3. In the **Assembly Builder** tab:
           - Add new assemblies to your project
           - For each assembly, specify:
             - Wood types needed
             - Lengths (in centimeters)
             - Quantity of each piece
             - Number of units needed
           - Use the 💾 button to save your changes

        ### 📊 Using the Cut List
        The **Cut List Summary** tab shows:
        - Total wood needed by type
        - Cost breakdown
        - Visual distribution of wood usage
        - Detailed list of all pieces needed

        You can export your cut list in two formats:
        - Summary: Overview of total wood needed by type
        - Detailed: Complete breakdown including assembly information

        ### 💡 Tips
        - All length inputs are in centimeters for ease of use
        - Prices are calculated per meter of wood
        - Save your changes frequently using the 💾 buttons
        - Use the units feature to easily duplicate assemblies
        - Check the project stats in the sidebar to track your progress

        ### 🔄 Workflow Example
        1. Create a new project
        2. Add wood types to your catalog
        3. Create assemblies for each component
        4. Add wood pieces to each assembly
        5. Specify quantities and units needed
        6. Generate and export your cut list

        ### 🎯 Best Practices
        - Organize your assemblies logically
        - Use descriptive names for assemblies
        - Double-check measurements before saving
        - Review the cut list for optimization opportunities
        """
        )

    with tab2:
        render_assembly_builder(
            st.session_state.catalog, st.session_state.current_project
        )

    with tab3:
        render_cut_list(st.session_state.current_project, st.session_state.catalog)

    with tab4:
        render_catalog_management(st.session_state.catalog)


if __name__ == "__main__":
    main()
