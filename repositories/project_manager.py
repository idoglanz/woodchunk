import json
import os
from pathlib import Path

from models.wood import Assembly, Project


class ProjectManager:
    def __init__(self, projects_dir: str = "projects"):
        self.projects_dir = projects_dir
        # Create projects directory if it doesn't exist
        os.makedirs(projects_dir, exist_ok=True)

    def save_project(self, project: Project) -> None:
        """Save a project to a JSON file"""
        file_path = Path(self.projects_dir) / f"{project.name}.json"
        with open(file_path, "w") as f:
            json.dump(project.model_dump(), f, indent=2)

    def load_project(self, project_name: str) -> Project:
        """Load a project from a JSON file"""
        file_path = Path(self.projects_dir) / f"{project_name}.json"
        with open(file_path, "r") as f:
            data = json.load(f)
            return Project.model_validate(data)

    def get_available_projects(self) -> list[str]:
        """Get a list of available project names"""
        projects = []
        for file in os.listdir(self.projects_dir):
            if file.endswith(".json"):
                projects.append(file[:-5])  # Remove .json extension
        return sorted(projects)

    def delete_project(self, project_name: str) -> None:
        """Delete a project file"""
        file_path = Path(self.projects_dir) / f"{project_name}.json"
        if file_path.exists():
            os.remove(file_path)
