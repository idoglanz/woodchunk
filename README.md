# 🪵 Woodchunk - Cut List Calculator

A Streamlit-based application for woodworking project management and cut list calculation. This tool helps woodworkers organize their projects, manage wood types, and generate efficient cut lists.

## Features

- 📋 Project Management: Create and manage multiple woodworking projects
- 🗂️ Wood Type Catalog: Maintain a catalog of different wood types and their properties
- 🔨 Assembly Builder: Design assemblies with multiple pieces
- ✂️ Cut List Generation: Automatically generate optimized cut lists for your projects
- 📊 Project Statistics: View detailed statistics about your projects

## Prerequisites

- Python 3.8 or higher
- pip (Python package installer)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/woodchunk.git
cd woodchunk
```

2. Install the required dependencies:
```bash
pip install -r requirements.txt
```

## Running the Application

To start the application, run:
```bash
streamlit run app.py
```

The application will open in your default web browser at `http://localhost:8501`.

## Project Structure

- `app.py`: Main application file containing the Streamlit interface
- `catalog.py`: Wood type catalog management
- `project_manager.py`: Project management functionality
- `components/`: UI components and views
- `models/`: Data models and schemas
- `projects/`: Project data storage
- `sample_catalog.json`: Sample wood type catalog

## Usage

1. **Wood Type Catalog**: Start by managing your wood types in the catalog
2. **Create a Project**: Use the new project dialog to start a new woodworking project
3. **Add Assemblies**: Build your project by adding assemblies and pieces
4. **Generate Cut List**: View and export the optimized cut list for your project

## Dependencies

- streamlit==1.43.0: Web application framework
- pydantic==2.6.3: Data validation using Python type annotations
- pandas==2.3: Data manipulation and analysis

## Contributing

Feel free to submit issues and enhancement requests!
