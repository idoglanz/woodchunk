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
            {st.session_state.current_project.name}
        </h1>
    """,
        unsafe_allow_html=True,
    )

    # Main tabs with custom styling
    tab1, tab2, tab3 = st.tabs(
        ["🔨 Assembly Builder", "📊 Cut List Summary", "📋 Catalog Management"]
    )

    with tab1:
        render_assembly_builder(
            st.session_state.catalog, st.session_state.current_project
        )

    with tab2:
        render_cut_list(st.session_state.current_project, st.session_state.catalog)

    with tab3:
        render_catalog_management(st.session_state.catalog)


if __name__ == "__main__":
    main()
