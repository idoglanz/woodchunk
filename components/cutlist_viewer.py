import streamlit as st
from models.wood import WoodType, CutList, Project
from catalog import WoodTypeCatalog
import pandas as pd
import io

def calculate_cut_list(project: Project, catalog: WoodTypeCatalog) -> list[CutList]:
    """Calculate the cut list from all assemblies in the project"""
    # Group pieces by wood type
    wood_type_pieces = {}
    
    for assembly in project.assemblies:
        for piece in assembly.pieces:
            wood_type = catalog.get_wood_type(piece.wood_type_index)
            if wood_type:
                if piece.wood_type_index not in wood_type_pieces:
                    wood_type_pieces[piece.wood_type_index] = {
                        'wood_type': wood_type,
                        'total_length': 0,
                        'total_price': 0
                    }
                
                # Add piece length and price to totals
                total_length = piece.length * piece.quantity
                wood_type_pieces[piece.wood_type_index]['total_length'] += total_length
                wood_type_pieces[piece.wood_type_index]['total_price'] += total_length * wood_type.price_per_meter

    # Convert to list of CutList objects
    return [
        CutList(
            wood_type=info['wood_type'],
            total_length=info['total_length'],
            total_price=info['total_price']
        )
        for info in wood_type_pieces.values()
    ]

def get_detailed_cut_list(project: Project, catalog: WoodTypeCatalog) -> list[dict]:
    """Get a detailed cut list with assembly information"""
    detailed_list = []
    
    for assembly in project.assemblies:
        for piece in assembly.pieces:
            wood_type = catalog.get_wood_type(piece.wood_type_index)
            if wood_type:
                detailed_list.append({
                    'Assembly': assembly.name,
                    'Wood Type': f"{wood_type.width}x{wood_type.height}mm",
                    'Description': wood_type.description,
                    'Length (m)': piece.length,
                    'Quantity': piece.quantity,
                    'Total Length (m)': piece.length * piece.quantity,
                    'Price/m': wood_type.price_per_meter,
                    'Total Price': piece.length * piece.quantity * wood_type.price_per_meter
                })
    
    return detailed_list

def export_summary_csv(cut_list: list[CutList]) -> str:
    """Create a CSV string for the summary cut list"""
    data = []
    for item in cut_list:
        data.append({
            'Dimensions': f"{item.wood_type.width}x{item.wood_type.height}mm",
            'Description': item.wood_type.description,
            'Total Length (m)': item.total_length,
            'Price/m': item.wood_type.price_per_meter,
            'Total Price': item.total_price
        })
    
    df = pd.DataFrame(data)
    buffer = io.StringIO()
    df.to_csv(buffer, index=False)
    return buffer.getvalue()

def export_detailed_csv(detailed_list: list[dict]) -> str:
    """Create a CSV string for the detailed cut list"""
    df = pd.DataFrame(detailed_list)
    buffer = io.StringIO()
    df.to_csv(buffer, index=False)
    return buffer.getvalue()

def render_cut_list(project: Project, catalog: WoodTypeCatalog):
    """Render the cut list summary tab"""
    st.header("Cut List Summary")
    
    if not project.assemblies:
        st.info("No assemblies added yet. Add some assemblies to see the cut list.")
        return
    
    cut_list = calculate_cut_list(project, catalog)
    
    if not cut_list:
        st.info("No wood pieces added to assemblies yet.")
        return
    
    # Export buttons
    col1, col2 = st.columns(2)
    with col1:
        summary_csv = export_summary_csv(cut_list)
        st.download_button(
            "📥 Export Summary",
            summary_csv,
            file_name=f"{project.name}_summary.csv",
            mime="text/csv",
            help="Download a summary of total wood needed by type",
            use_container_width=True
        )
    
    with col2:
        detailed_list = get_detailed_cut_list(project, catalog)
        detailed_csv = export_detailed_csv(detailed_list)
        st.download_button(
            "📥 Export Detailed Cut List",
            detailed_csv,
            file_name=f"{project.name}_detailed.csv",
            mime="text/csv",
            help="Download a detailed cut list with assembly information",
            use_container_width=True
        )
    
    st.markdown("---")
    
    # Display the cut list
    st.subheader("Required Wood Pieces")
    
    # Calculate total price
    total_price = sum(item.total_price for item in cut_list)
    
    # Display each wood type's requirements
    for item in cut_list:
        with st.expander(f"{item.wood_type.width}x{item.wood_type.height}mm - {item.wood_type.description}", expanded=True):
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Total Length", f"{item.total_length:.1f}m")
            with col2:
                st.metric("Price per Meter", f"₪{item.wood_type.price_per_meter:.2f}")
            with col3:
                st.metric("Total Price", f"₪{item.total_price:.2f}")
            
            if item.wood_type.available_lengths:
                st.write("Available Lengths:", ", ".join(f"{l}m" for l in item.wood_type.available_lengths))
    
    # Display total price
    st.markdown("---")
    st.metric("Total Project Cost", f"₪{total_price:.2f}")
