//! D1 query helpers.

use serde::de::DeserializeOwned;
use wasm_bindgen::JsValue;
use worker::D1Database;

pub type WResult<T> = worker::Result<T>;

pub fn s(v: &str) -> JsValue {
    JsValue::from_str(v)
}

pub fn i(v: i64) -> JsValue {
    // D1 numbers arrive as JS numbers; amounts/timestamps stay well under 2^53.
    JsValue::from(v as f64)
}

pub fn opt_s(v: Option<&str>) -> JsValue {
    match v {
        Some(x) => s(x),
        None => JsValue::NULL,
    }
}

pub fn opt_i(v: Option<i64>) -> JsValue {
    match v {
        Some(x) => i(x),
        None => JsValue::NULL,
    }
}

pub fn flag(v: i64) -> bool {
    v != 0
}

pub async fn q_all<T: DeserializeOwned>(
    db: &D1Database,
    sql: &str,
    p: Vec<JsValue>,
) -> WResult<Vec<T>> {
    db.prepare(sql).bind(&p)?.all().await?.results::<T>()
}

pub async fn q_one<T: DeserializeOwned>(
    db: &D1Database,
    sql: &str,
    p: Vec<JsValue>,
) -> WResult<Option<T>> {
    db.prepare(sql).bind(&p)?.first::<T>(None).await
}

pub async fn exec(db: &D1Database, sql: &str, p: Vec<JsValue>) -> WResult<()> {
    db.prepare(sql).bind(&p)?.run().await?;
    Ok(())
}

pub fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

pub fn now_secs() -> i64 {
    now_ms() / 1000
}
