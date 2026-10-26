"""The catalog kept in step with Noyman's price list and the steel sizes: ids kept, prices tracked,
items no longer sold retired, and each version applied once."""

from app.catalog_sync import STEEL_SUPPLIER, build_steel, sync_noyman, sync_steel
from app.models.catalog import ProfileSpec


async def legacy_item(database, key: str) -> dict:
    seed = await database.meta.find_one({"_id": "seed"})
    return await database.catalog_items.find_one({"_id": seed["legacy_map"][key]})


async def test_noyman_updates_the_original_items_in_place(database):
    supplier = await database.suppliers.find_one({"name": "Noyman (נוימן)"})
    assert supplier and supplier["url"].startswith("https://www.noyman-wood")
    assert not await database.suppliers.find_one({"name": "Original catalog yard"})

    # The first catalog's 25/75 pine is Noyman's "27/80": same item, Noyman's lengths and history.
    pine = await legacy_item(database, "lumber:13")
    assert pine["status"] == "active" and pine["supplier_id"] == supplier["_id"]
    assert pine["name"] == {"en": "27 × 80 pine, planed (20 × 70 net)", "he": "אורן 27/80 מוקצע פע"}
    assert (pine["thickness_mm"], pine["width_mm"], pine["price_per_m"]) == (20, 70, 5.86)
    assert [s["length_mm"] for s in pine["lumber_stock"]] == [3600, 4200, 5100]
    assert [p["note"] for p in pine["price_history"]] == ["original catalog"]  # same price: nothing to record
    # 75/75 pine went from 17.37 to 17.75 a metre: the change is recorded.
    post = await legacy_item(database, "lumber:45")
    assert [(p["price"], p["note"]) for p in post["price_history"]] == [(17.37, "original catalog"), (17.75, "Noyman website 2026-10-26")]

    # The "18 mm pine plywood" sheet is Noyman's edge-glued panel, in all its sizes.
    panel = await legacy_item(database, "sheet:pine:18")
    assert panel["name"]["en"] == "18 mm pine panel (edge-glued)"
    assert len(panel["sheet_stock"]) > 20
    assert {"length_mm": 2440, "width_mm": 1220, "price": 454.3} in panel["sheet_stock"]

    # Gone from Noyman (Carolina pine): retired, so projects using it still show it.
    assert (await legacy_item(database, "lumber:22"))["status"] == "retired"
    # New at Noyman: glulam beams.
    assert await database.catalog_items.find_one({"supplier_id": supplier["_id"], "material": "glulam spruce", "status": "active"})


async def test_each_version_is_applied_once(database):
    pine = await legacy_item(database, "lumber:13")
    await database.catalog_items.update_one({"_id": pine["_id"]}, {"$set": {"price_per_m": 6.5}})
    await sync_noyman(database)  # same data: an admin's edit stands
    assert (await legacy_item(database, "lumber:13"))["price_per_m"] == 6.5

    await database.meta.delete_one({"_id": "catalog:noyman"})  # as if the price list changed
    await sync_noyman(database)
    again = await legacy_item(database, "lumber:13")
    assert again["price_per_m"] == 5.86 and again["_id"] == pine["_id"]
    assert again["price_history"][-1]["price"] == 5.86


async def test_steel_sizes_keep_ids_and_retire_old_ones(database):
    supplier = await database.suppliers.find_one({"name": STEEL_SUPPLIER})
    tube = await database.catalog_items.find_one({"supplier_id": supplier["_id"], "profile.shape": "rect_tube", "profile.w": 40, "profile.h": 40, "profile.t": 2})
    old = build_steel(supplier["_id"])[0]
    old.profile = ProfileSpec(shape="round_tube", w=40, h=40, t=2)  # a size no longer listed
    await database.catalog_items.insert_one(old.to_mongo())
    await database.catalog_items.update_one({"_id": tube["_id"]}, {"$set": {"price_per_m": 21.0}})

    await database.meta.delete_one({"_id": "catalog:steel"})
    await sync_steel(database)

    assert (await database.catalog_items.find_one({"_id": old.id}))["status"] == "retired"
    kept = await database.catalog_items.find_one({"_id": tube["_id"]})
    assert kept["status"] == "active" and kept["price_per_m"] == 21.0  # an entered price is kept
    bars = await database.catalog_items.count_documents({"supplier_id": supplier["_id"], "profile.shape": "round_bar"})
    assert bars == 5
