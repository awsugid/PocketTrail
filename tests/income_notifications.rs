//! Execute production notification SQL, including roles without global permissions.
use rusqlite::{params, Connection};

fn sql(marker: &str) -> String {
    let source = include_str!("../src/web/notify.rs");
    let start = source.find(marker).unwrap();
    source[start..].split('"').nth(1).unwrap().to_owned()
}

#[test]
fn income_upload_preserves_review_history() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE transactions(id,org_id,amount_minor,status,approved_at,approved_by_membership_id,approval_note,updated_at,revision,mutation_token);
        INSERT INTO transactions VALUES(1,1,100,'approved',123,9,'Legacy approval',1,0,'');
        INSERT INTO transactions VALUES(2,1,-100,'approved',123,9,'Legacy approval',1,0,'');").unwrap();
    let source = include_str!("../src/web/txns.rs");
    let start = source.find("UPDATE transactions SET status=CASE WHEN amount_minor>0").unwrap();
    let sql = source[start..].split('"').next().unwrap();
    for id in [1,2] { db.execute(sql, params![2,"token",id,1,0]).unwrap(); }
    let income: (String, i64, i64, String) = db.query_row("SELECT status,approved_at,approved_by_membership_id,approval_note FROM transactions WHERE id=1", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
    assert_eq!(income, ("approved".into(),123,9,"Legacy approval".into()));
    let expense: (String,Option<i64>,Option<i64>,String) = db.query_row("SELECT status,approved_at,approved_by_membership_id,approval_note FROM transactions WHERE id=2", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
    assert_eq!(expense,("pending".into(),None,None,String::new()));
}

#[test]
fn income_initial_and_digest_follow_current_routing() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE organizations(id,slug,notifications_enabled,notification_revision,income_explanation_role_id,notification_cutoff_date);
        CREATE TABLE memberships(id,org_id,user_id,role_id,removed_at);
        CREATE TABLE roles(id,org_id,permissions);
        CREATE TABLE users(id,name);
        CREATE TABLE pockets(id,org_id,owner_membership_id);
        CREATE TABLE transactions(id,org_id,pocket_id,amount_minor,explanation,suppressed,txn_date);
        CREATE TABLE notification_outbox(id INTEGER PRIMARY KEY,org_id,kind,to_membership_id,transaction_id,subject,body,created_at,cancelled_at);
        INSERT INTO organizations VALUES(1,'org',1,0,10,'2025-01-01');
        INSERT INTO roles VALUES(10,1,'[]'),(20,1,'[]');
        INSERT INTO users VALUES(1,'One'),(2,'Two'),(3,'Owner');
        INSERT INTO memberships VALUES(1,1,1,10,NULL),(2,1,2,10,NULL),(3,1,3,20,NULL);
        INSERT INTO pockets VALUES(1,1,3);
        INSERT INTO transactions VALUES(7,1,1,100,'',0,'2026-01-01');").unwrap();
    let insert = sql("pub async fn insert_row(");
    let view_source = include_str!("../src/web/notify.rs");
    let start = view_source.find("SELECT n.id, n.kind, n.subject").unwrap();
    let view = view_source[start..].split('"').next().unwrap();
    let enqueue = |mid: i64, kind: &str, txn: Option<i64>| {
        db.execute(&insert, params![1,kind,mid,txn,"Subject","Documentation task — /org/org/transactions/7\n",1,Option::<i64>::None]).unwrap();
    };
    let visible = |role: Option<i64>| -> Vec<i64> {
        db.prepare(view).unwrap().query_map(params![1,role], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    enqueue(1,"mention",Some(7));
    assert_eq!(visible(Some(10)).len(),1);
    db.execute("DELETE FROM notification_outbox",[]).unwrap();
    enqueue(1,"assignment",Some(7));
    enqueue(2,"assignment",Some(7));
    enqueue(1,"digest",None);
    assert_eq!(visible(Some(10)).len(),3);
    db.execute("UPDATE memberships SET removed_at=1 WHERE id=2",[]).unwrap();
    assert_eq!(visible(Some(10)).len(),2);
    db.execute("UPDATE organizations SET income_explanation_role_id=20",[]).unwrap();
    assert!(visible(Some(20)).is_empty());
    enqueue(3,"assignment",Some(7));
    enqueue(3,"digest",None);
    assert_eq!(visible(Some(20)).len(),2);
    db.execute("UPDATE organizations SET income_explanation_role_id=NULL",[]).unwrap();
    assert_eq!(visible(None).len(),2);
    db.execute("UPDATE transactions SET explanation='Member notes'",[]).unwrap();
    assert!(visible(None).is_empty());
    db.execute("UPDATE transactions SET explanation='',suppressed=1",[]).unwrap();
    enqueue(3,"assignment",Some(7));
    assert!(visible(None).is_empty());
    db.execute("UPDATE transactions SET suppressed=0,txn_date='2024-01-01'",[]).unwrap();
    enqueue(3,"assignment",Some(7));
    assert!(visible(None).is_empty());
}
