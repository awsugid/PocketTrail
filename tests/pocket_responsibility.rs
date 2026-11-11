use rusqlite::Connection;

#[test]
fn all_migrations_accept_synthetic_seed() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    let mut paths = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "sql"))
        .collect::<Vec<_>>();
    paths.sort();
    for path in paths {
        db.execute_batch(&std::fs::read_to_string(&path).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    }
    db.execute_batch(include_str!("fixtures/seed.sql")).unwrap();
    assert_eq!(db.query_row("SELECT COUNT(*) FROM pockets p JOIN memberships m ON m.id=p.owner_membership_id AND m.org_id=p.org_id AND m.removed_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM actor_mappings WHERE pocket_id=1 AND org_id=1",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    assert_eq!(db.query_row("SELECT COUNT(*) FROM organizations WHERE is_synthetic=1 AND creator_membership_id IS NOT NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
}

#[test]
fn ownership_and_mapping_constraints() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(include_str!("../migrations/0001_init.sql"))
        .unwrap();
    db.execute_batch("INSERT INTO users(id,email,name,created_at) VALUES('u','u@x','U',1),('v','v@x','V',1); INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',1),(2,'two','Two',1); INSERT INTO roles(id,org_id,name) VALUES(1,1,'Admin'),(2,2,'Admin'); INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',1,'u',1),(2,1,'v',1,'v',2),(3,2,'u',2,'u',1); INSERT INTO pockets(id,org_id,name) VALUES(1,1,'Old');").unwrap();
    db.execute_batch(include_str!("../migrations/0010_pocket_responsibility.sql"))
        .unwrap();
    assert_eq!(
        db.query_row(
            "SELECT owner_membership_id FROM pockets WHERE id=1",
            [],
            |r| r.get::<_, Option<i64>>(0)
        )
        .unwrap(),
        None
    );
    assert!(db
        .execute("INSERT INTO pockets(org_id,name) VALUES(1,'Missing')", [])
        .is_err());
    assert!(db
        .execute("UPDATE pockets SET owner_membership_id=3 WHERE id=1", [])
        .is_err());
    db.execute("UPDATE pockets SET owner_membership_id=1 WHERE id=1", [])
        .unwrap();
    assert!(db
        .execute("UPDATE memberships SET removed_at=2 WHERE id=1", [])
        .is_err());
    db.execute("UPDATE pockets SET owner_membership_id=2 WHERE id=1", [])
        .unwrap();
    db.execute("UPDATE memberships SET removed_at=2 WHERE id=1", [])
        .unwrap();
    db.execute(
        "INSERT INTO pockets(id,org_id,name,owner_membership_id) VALUES(2,1,'New',2)",
        [],
    )
    .unwrap();
    let insert="INSERT INTO actor_mappings(org_id,pocket_id,pattern,membership_id,created_by_membership_id,created_at) VALUES(1,?1,?2,2,2,1)";
    db.execute(insert, rusqlite::params![1, " Free text "])
        .unwrap();
    assert!(db
        .execute(insert, rusqlite::params![1, "free TEXT"])
        .is_err());
    db.execute(insert, rusqlite::params![2, "free TEXT"])
        .unwrap();
    db.execute(insert, rusqlite::params![1, "Another label"])
        .unwrap();
    assert!(db.execute("INSERT INTO actor_mappings(org_id,pocket_id,pattern,membership_id,created_by_membership_id,created_at) VALUES(2,1,'Foreign',3,3,1)",[]).is_err());
}
