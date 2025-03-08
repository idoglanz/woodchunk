import streamlit as st
from models.wood import Project

@st.dialog("Create New Project")
def new_project_dialog():
    st.title("Create New Project")
    new_project_name = st.text_input("Project Name")
    new_project_description = st.text_area("Description (optional)")
    if st.button("Create", type="primary", use_container_width=True):
        if new_project_name:
            new_project = Project(
                name=new_project_name,
                description=new_project_description
            )
            st.session_state.current_project = new_project
            st.session_state.project_manager.save_project(new_project)
            st.rerun()
        else:
            st.error("Please enter a project name")
