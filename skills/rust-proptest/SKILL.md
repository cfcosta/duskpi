---
name: rust-proptest
description: Teaches the LLM how to do property tests correctly in rust
---

## 0. Purpose

This skill teaches an LLM how to design and implement **high-leverage, reproducible property-based tests (PBT)** in Rust using:

- `hegeltest` (crate name on crates.io, lib name `hegel`) for generators, shrinking, and test execution.

Hegel is based on Hypothesis. Its engine is a native Rust port of the Hypothesis engine (`libhegel`), with no Python dependency. By default the build script compiles the engine into a `libhegel_c` shared library that tests load at runtime; `cargo test` handles this with no setup. Add it with `cargo add --dev hegeltest`.

The goal is not to generate "random tests", but to encode **executable specifications** using:

- Differential testing (SUT vs reference)
- Model-based testing (stateful APIs)
- Metamorphic relations
- Algebraic laws
- Round-trip invariants
- Feature-aware coverage patterns

This document is repo-ready and intended to be versioned.

---

# 1. Non-Negotiable Quality Bar

A good PBT suite MUST:

1. Encode real behavioral laws — not tautologies.
2. Use an oracle (reference, model, metamorphic relation) whenever possible.
3. Generate valid inputs by construction (avoid rejection storms).
4. Shrink to human-interpretable counterexamples.
5. Be reproducible (persist failures).
6. Be deterministic in generation and test body.

---

# 2. Required Output Structure (When the LLM Generates Tests)

Whenever generating property tests, the LLM MUST output:

1. **Property Inventory**
   - Name
   - Oracle style
   - Why it matters

2. **Generator Plan**
   - Input structure
   - How it avoids rejection
   - Shrink intent

3. **Rust Code**
   - Proper `#[cfg(test)]` or integration tests
   - `#[derive(DefaultGenerator)]` where useful
   - `#[hegel::test]` with reasonable `test_cases`
   - Comments explaining invariants

4. **CI Configuration Guidance**
   - Hegel auto-detects CI (GitHub Actions, GitLab CI, CircleCI, etc.) and selects the shipped `ci` profile
   - In CI: database is disabled, tests are derandomized, and `TooSlow` is suppressed by default
   - Recommend suite-wide `test_cases` counts in `hegel.toml` profiles, and per-test counts via the attribute only when one test needs a different count

---

# 3. Decision Tree: Choosing the Right Property Type

Use this order of preference:

### 1. Differential Testing (Highest Leverage)

Compare:

- Optimized vs naive implementation
- Your parser vs known correct parser
- Your data structure vs `Vec`, `BTreeMap`, etc.

This catches real bugs quickly.

---

### 2. Model-Based Testing (Stateful APIs)

If the API mutates state:

- Use `#[hegel::state_machine]` on an impl block
- Define `#[rule]` methods for operations
- Define `#[invariant]` methods for assertions
- Run it with `hegel::stateful::machine(model).run(tc)`

---

### 3. Round-Trip Properties

Examples:

- `decode(encode(x)) == x`
- `parse(print(x))` idempotence

---

### 4. Metamorphic Testing

When no oracle exists:

- Define transformation `t(x)`
- Assert relationship between `f(x)` and `f(t(x))`

---

### 5. Algebraic Laws

Use when mathematically meaningful:

- Commutativity
- Associativity
- Idempotence
- Identity laws

Avoid inventing meaningless algebra.

---

# 4. Generator Design Rules

## 4.1 Generate Valid Inputs by Construction

Bad:

- Generate arbitrary input
- Reject unless valid

Good:

- Encode invariants in the generator

Example:

```rust
use hegel::generators as gs;

#[hegel::composite]
fn sorted_unique_vec(tc: &hegel::TestCase) -> Vec<u32> {
    let mut v: Vec<u32> = tc.draw(gs::vecs(gs::integers::<u32>()).max_size(64));
    v.sort();
    v.dedup();
    v
}
```

Shrinking preserves validity: the engine shrinks the underlying choice sequence and re-runs the generator, so every shrunk value still passes through `sort` and `dedup`.

---

## 4.2 Avoid Rejection Storms

If you use `tc.assume(condition)`, you must justify it.

If rejection count grows, redesign the generator. Hegel will raise a `FilterTooMuch` health check if too many test cases are rejected. This includes `.filter()` and unique collections, which always rejection-sample: a filter that keeps one value in a hundred, or a `hashsets` that must contain most of a small alphabet, fails the health check.

You can suppress this with `#[hegel::test(suppress_health_check = [HealthCheck::FilterTooMuch])]`, but prefer fixing the generator instead.

Prefer `tc.reject()` over `tc.assume(false)` when the rejection happens inside a `match` arm: it returns `!`, so the compiler knows the rest of the arm is unreachable.

---

## 4.3 Shrink Toward Semantic Simplicity

Shrinking is handled by the engine, which shrinks the choices behind each draw. Design generators so that smaller draws naturally correspond to simpler, easier-to-understand inputs.

Use `.min_value()` / `.max_value()` / `.min_size()` / `.max_size()` to bound the search space meaningfully.

---

## 4.4 Prefer Reusable Generator Functions

Do not embed complex generators inline repeatedly.

Instead, use `#[hegel::composite]`:

```rust
#[hegel::composite]
fn small_vec_u8(tc: &hegel::TestCase) -> Vec<u8> {
    tc.draw(gs::vecs(gs::integers::<u8>()).max_size(64))
}
```

Reuse across tests via `tc.draw(small_vec_u8())`.

A composite's first parameter is `&TestCase` (a reference). Extra parameters become parameters of the generated factory function and must implement `Clone`: `fn sorted_vec(tc: &TestCase, min_len: usize) -> Vec<i32>` is drawn with `tc.draw(sorted_vec(3))`. `#[composite]` expands to a named, `Clone`-able generator struct, so composites can recurse into themselves and can be stored in structs.

A composite's return type must implement `PrettyPrintable` for `tc.draw` to accept it (see §5.3). Standard types already do.

A helper function that returns a generator should declare `-> impl PrintableGenerator<T>`, not `-> impl Generator<T>`. The latter hides printability, and callers then cannot `tc.draw` from it.

---

# 5. Hegel API Usage Rules

## 5.1 Basic Test Structure

Every hegel test takes a `TestCase` parameter and draws values explicitly. `use hegel::prelude::*;` imports `TestCase`, `gs` (the generators module), and the `Generator`, `PrintableGenerator`, `DefaultGenerator` and `PrettyPrintable` names in one line. The explicit imports below are equivalent:

```rust
use hegel::TestCase;
use hegel::generators as gs;

#[hegel::test]
fn test_example(tc: TestCase) {
    let n: i32 = tc.draw(gs::integers());
    let s: String = tc.draw(gs::text().max_size(128));
    // assert properties
}
```

`#[hegel::test]` automatically adds `#[test]` — do NOT add `#[test]` yourself.

---

## 5.2 TestCase Methods

- `tc.draw(generator)` — draw a value and record it for the failure report (requires a `PrintableGenerator`, see §5.3)
- `tc.draw_silent(generator)` — draw without recording (accepts any `Generator`)
- `tc.draw_named("name", generator)` — draw and report the value under an explicit name
- `tc.assume(condition)` — reject the current test case if false
- `tc.reject()` — reject unconditionally; returns `!`
- `tc.note(&str)` — attach debug info shown only on failure replay
- `tc.target(score: f64)` — steer generation toward inputs that maximise `score` (inside `#[hegel::test]`, the source expression becomes the label; use `tc.target_labelled(score, label)` to set it explicitly)
- `tc.event("label")` / `tc.event_value("label", f64)` — record that a situation occurred, or a numeric observation; with `show_statistics = true` (or `HEGEL_STATISTICS=1`) the run ends with a per-label report. Use this to check that your generators actually reach the cases you care about.
- `tc.repeat(|| { ... })` — run a body "logically forever" until the test case ends; each iteration is noted in the failure replay

`TestCase` is `Send` but not `Sync`. You can `tc.clone()` it and draw from the clone on another thread. Each clone draws from its own deterministic stream, and all clones share one outcome. Join every such thread before the test returns.

`#[hegel::test]` rewrites `let x = tc.draw(...)` so that failures print `let x = <value>;` with real variable names. Mark helper functions that draw with `#[hegel::test_helper]` to get the same naming inside them.

---

## 5.3 Printing Drawn Values

Failures print each drawn value as a pastable Rust expression (`vec![1, 2]`, `"x".to_string()`, `f64::NAN`), not as `Debug` output. Printing is a property of the generator:

- Built-in leaf generators, collections, tuples, `optional`, `one_of!`, `flat_map`, `recursive` and `#[derive(DefaultGenerator)]` generators are all printable.
- `map`, `filter`, `just`, `sampled_from`, `boxed` and `#[composite]` are printable when the produced type implements `PrettyPrintable`.

When `tc.draw` fails to compile because a type is not printable:

- For your own type, add `#[derive(hegel::PrettyPrintable)]` (fields that are foreign types can use `#[pretty(debug)]`), or `hegel::pretty_print_as_debug!(MyType);` to print through `Debug`.
- For a foreign type, fix the generator at the draw site: `.print_as_debug()`, `.map(Foo::from_raw).print_as_call("Foo::from_raw")`, or `.print_with(|v, p| ...)`.
- Or draw with `tc.draw_silent(...)` when the value is not worth reporting.

Annotate only the draws the compiler rejects. Adding `.print_as_debug()` to a draw that is already printable only makes the report worse.

`.boxed()` keeps printability only through the value's `PrettyPrintable` impl. Use `.boxed_printable()` to keep a custom printing strategy through type erasure.

---

## 5.4 Deriving DefaultGenerator

For your own types, derive `DefaultGenerator` to enable `gs::default::<T>()`:

```rust
use hegel::DefaultGenerator;
use hegel::generators as gs;

#[derive(DefaultGenerator, Debug)]
struct Input {
    n: u32,
    bytes: Vec<u8>,
}

#[hegel::test]
fn test_with_input(tc: TestCase) {
    let i: Input = tc.draw(gs::default::<Input>());
    // use i.n, i.bytes
}
```

Note: `hegel::DefaultGenerator` is the derive macro; `hegel::generators::DefaultGenerator` is the trait. `gs::default::<T>()` returns `T::Generator` directly (it is not boxed), so builder methods stay available. A derived generator prints field by field, so the type itself does not need `PrettyPrintable`.

Customize specific fields by chaining builder methods on `gs::default::<T>()`:

```rust
let i: Input = tc.draw(
    gs::default::<Input>()
        .n(gs::integers().min_value(0_u32).max_value(10_000))
        .bytes(gs::vecs(gs::integers::<u8>()).max_size(128))
);
```

---

## 5.5 Enum Generation

```rust
#[derive(DefaultGenerator, Debug)]
enum Mode {
    Fast,
    Slow,
    Custom { factor: u32 },
}

#[hegel::test]
fn test_mode(tc: TestCase) {
    let mode: Mode = tc.draw(gs::default());
}
```

Customize data-carrying variants with snake_case builder methods named after the variant. Unit variants need no configuration.

- Struct variant `Custom { factor: u32 }`: `.custom(|g| ...)` takes a closure over the variant's generator, which has one builder per field.
- Tuple variant `Error(i32, String)`: `.error(g0, g1)` takes one generator per field, or `.error_with(|g| g._0(...)._1(...))` uses the closure form.

```rust
let mode: Mode = tc.draw(
    gs::default::<Mode>()
        .custom(|g| g.factor(gs::integers().min_value(1_u32).max_value(100)))
);
```

`#[derive(DefaultGenerator)]` also works on:

- generic types (`struct Point<T> { x: T }` works for any `T: DefaultGenerator`); lifetime parameters are not supported
- tuple structs, with positional builders: `gs::default::<Meters>()._0(gs::floats().min_value(0.0).max_value(3.0))`

---

## 5.6 Foreign Type Generation

For structs defined in another crate, `derive_generator!` creates a standalone generator type with `new()` and one builder method per field. The orphan rule prevents a `DefaultGenerator` impl, so `gs::default::<ForeignStruct>()` does not work for these types. Draw from the generated generator instead:

```rust
hegel::derive_generator!(ForeignStructGenerator for ForeignStruct {
    field1: String,
    field2: u32,
});

let v: ForeignStruct = tc.draw(
    ForeignStructGenerator::new().field2(gs::integers().max_value(100_u32))
);
```

For types in your own crate, use `#[derive(DefaultGenerator)]` instead.

---

## 5.7 Dependent Generation

Use `#[hegel::composite]` or `hegel::compose!` for values that depend on each other:

```rust
#[hegel::composite]
fn range_input(tc: &hegel::TestCase) -> (u32, u32) {
    let lo: u32 = tc.draw(gs::integers().min_value(0_u32).max_value(1000));
    let hi: u32 = tc.draw(gs::integers().min_value(lo).max_value(lo + 100));
    (lo, hi)
}
```

Or inline with `compose!` (the closure also receives `&TestCase`):

```rust
let (lo, hi) = tc.draw(hegel::compose!(|tc| {
    let lo: u32 = tc.draw(gs::integers().min_value(0_u32).max_value(1000));
    let hi: u32 = tc.draw(gs::integers().min_value(lo).max_value(lo + 100));
    (lo, hi)
}));
```

---

## 5.8 Combinators

Choose from multiple generators (`one_of!` takes any number of arguments, and they do not need boxing):

```rust
let value: i32 = tc.draw(hegel::one_of!(
    gs::integers::<i32>().min_value(0).max_value(10),
    gs::integers::<i32>().min_value(100).max_value(110),
));
```

Pick from a fixed list:

```rust
let op: &str = tc.draw(gs::sampled_from(vec!["add", "remove", "update"]));
```

`sampled_from` also accepts a slice (`&[T]`) or a reference to an array or `Vec`.

Draw from a fixed list as a collection:

```rust
let perm: Vec<i32> = tc.draw(gs::permutations(vec![1, 2, 3, 4, 5]));  // all elements, shuffled
let sub: Vec<i32> = tc.draw(gs::subsequences(vec![1, 2, 3, 4, 5]));   // subset, original order
let sample: Vec<i32> = tc.draw(gs::samples(vec![1, 2, 3]).max_size(10)); // with replacement by default
```

Optional values:

```rust
let maybe: Option<i32> = tc.draw(gs::optional(gs::integers()));
```

Tuples:

```rust
let (n, b, s) = tc.draw(hegel::tuples!(
    gs::integers::<i32>(),
    gs::booleans(),
    gs::text(),
));
```

---

## 5.9 Generator Combinators

All generators support these methods. They live on the `Generator` trait, so bring it into scope with `use hegel::generators::Generator;` (also re-exported as `hegel::Generator` and in `hegel::prelude`):

```rust
gen.map(|x| transform(x))         // transform output
gen.flat_map(|x| another_gen(x))   // dependent generation
gen.filter(|x| predicate(x))      // filter (retries 3 times, then assume(false))
gen.boxed()                        // type-erase into BoxedGenerator
```

`.filter()` always rejection-samples. Prefer constructing valid values directly (§4.1).

---

## 5.10 Recursive Generators

Use `gs::recursive(leaf, branch)` for trees, ASTs and JSON-like data. `branch` receives a generator of subtrees and returns a generator of one node:

```rust
use hegel::generators::{self as gs, Generator};

#[derive(Debug)]
enum Json {
    Number(f64),
    Array(Vec<Json>),
}
hegel::pretty_print_as_debug!(Json);

let value: Json = tc.draw(
    gs::recursive(
        gs::floats::<f64>().map(Json::Number),
        |json| gs::vecs(json).max_size(5).map(Json::Array),
    )
    .max_depth(5)
    .max_leaves(50),
);
```

For mutually recursive definitions, use `gs::deferred::<T>()` (printable handles) or `gs::deferred_silent::<T>()`, then call `.generator()` for handles and `.set(...)` once with the implementation. A `#[composite]` may also draw from itself.

---

## 5.11 Misconfiguration Is a Usage Error

Invalid generator arguments (`max_value` below `min_value`, an empty `sampled_from`/`one_of`, a non-finite `tc.target()` score, an unknown codec) abort the run with a clear message. They are not reported or shrunk as counterexamples.

---

# 6. Available Generators Reference

## 6.1 Primitives

| Function                   | Type              | Builder Methods                                                                                                                                               |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gs::integers::<T>()`      | all integer types | `.min_value(v)`, `.max_value(v)`                                                                                                                              |
| `gs::floats::<T>()`        | `f32`, `f64`      | `.min_value(v)`, `.max_value(v)`, `.min_value_exclusive(v)`, `.max_value_exclusive(v)`, `.allow_nan(bool)`, `.allow_infinity(bool)`, `.allow_subnormal(bool)` |
| `gs::booleans()`           | `bool`            | —                                                                                                                                                             |
| `gs::weighted_booleans(p)` | `bool`            | `true` with probability `p` in `[0.0, 1.0]`                                                                                                                   |
| `gs::just(value)`          | `T`               | —                                                                                                                                                             |
| `gs::unit()`               | `()`              | —                                                                                                                                                             |
| `gs::durations()`          | `Duration`        | `.min_value(Duration)`, `.max_value(Duration)`                                                                                                                |

## 6.2 Strings and Text

| Function                  | Type                  | Builder Methods                                                                                                                                                                                                                |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gs::text()`              | `String`              | `.min_size(n)`, `.max_size(n)`, `.alphabet(&str)`, `.codec(s)`, `.min_codepoint(u32)`, `.max_codepoint(u32)`, `.categories(&[&str])`, `.exclude_categories(&[&str])`, `.include_characters(&str)`, `.exclude_characters(&str)` |
| `gs::characters()`        | `char`                | `.codec(s)`, `.min_codepoint(u32)`, `.max_codepoint(u32)`, `.categories(&[&str])`, `.exclude_categories(&[&str])`, `.include_characters(&str)`, `.exclude_characters(&str)`                                                    |
| `gs::from_regex(pattern)` | `String`              | `.fullmatch(bool)` (default `true`), `.alphabet(CharactersGenerator)`                                                                                                                                                          |
| `gs::binary()`            | `Vec<u8>`             | `.min_size(n)`, `.max_size(n)`                                                                                                                                                                                                 |
| `gs::emails()`            | `String`              | —                                                                                                                                                                                                                              |
| `gs::urls()`              | `String`              | —                                                                                                                                                                                                                              |
| `gs::domains()`           | `String`              | `.max_length(n)`                                                                                                                                                                                                               |
| `gs::ip_addresses()`      | `std::net::IpAddr`    | `.v4()` (→ `Ipv4Addr`), `.v6()` (→ `Ipv6Addr`)                                                                                                                                                                                 |
| `gs::uuids()`             | `String` (hyphenated) | `.version(1..=5)`                                                                                                                                                                                                              |
| `gs::date_strings()`      | `String` (ISO format) | —                                                                                                                                                                                                                              |
| `gs::time_strings()`      | `String` (ISO format) | —                                                                                                                                                                                                                              |
| `gs::datetime_strings()`  | `String` (ISO format) | —                                                                                                                                                                                                                              |

`.exclude_min(bool)` and `.exclude_max(bool)` on floats are deprecated and panic when called. Use `.min_value_exclusive(v)` / `.max_value_exclusive(v)`.

`codec` accepts `"ascii"` (same as `.max_codepoint(0x7F)`), `"latin-1"`/`"iso-8859-1"` (`.max_codepoint(0xFF)`), and `"utf-8"` (no-op). For typed, boundable dates and times, use the `chrono` or `jiff` extras (§6.5).

## 6.3 Collections

| Function                             | Type             | Builder Methods                                          |
| ------------------------------------ | ---------------- | -------------------------------------------------------- |
| `gs::vecs(element_gen)`              | `Vec<T>`         | `.min_size(n)`, `.max_size(n)`, `.unique(bool)`          |
| `gs::hashsets(element_gen)`          | `HashSet<T>`     | `.min_size(n)`, `.max_size(n)`                           |
| `gs::hashmaps(key_gen, val_gen)`     | `HashMap<K, V>`  | `.min_size(n)`, `.max_size(n)`                           |
| `gs::btree_sets(element_gen)`        | `BTreeSet<T>`    | `.min_size(n)`, `.max_size(n)`                           |
| `gs::btree_maps(key_gen, val_gen)`   | `BTreeMap<K, V>` | `.min_size(n)`, `.max_size(n)`                           |
| `gs::arrays::<_, _, N>(element_gen)` | `[T; N]`         | —                                                        |
| `gs::permutations(values)`           | `Vec<T>`         | —                                                        |
| `gs::subsequences(values)`           | `Vec<T>`         | `.min_size(n)`, `.max_size(n)`                           |
| `gs::samples(values)`                | `Vec<T>`         | `.min_size(n)`, `.max_size(n)`, `.without_replacement()` |

## 6.4 Combinators

| Function/Macro                    | Description                                         |
| --------------------------------- | --------------------------------------------------- |
| `gs::optional(gen)`               | `Option<T>`                                         |
| `gs::sampled_from(values)`        | pick uniformly from a fixed list                    |
| `gs::one_of(iter_of_gens)`        | choose from a runtime-sized list of same-type gens  |
| `hegel::one_of!(g1, g2, ...)`     | choose from any number of generators, unboxed       |
| `hegel::tuples!(g1, g2, ...)`     | tuple generator (0 to 12 elements)                  |
| `hegel::compose!(\|tc\| { ... })` | inline composed generator                           |
| `gs::recursive(leaf, branch)`     | recursive data (trees, JSON)                        |
| `gs::deferred::<T>()`             | forward reference for mutually recursive generators |
| `gs::default::<T>()`              | the type's `DefaultGenerator`, with builders        |

## 6.5 Extras (Cargo Features)

| Feature      | Module                      | Provides                                |
| ------------ | --------------------------- | --------------------------------------- |
| `chrono`     | `hegel::extras::chrono`     | typed, boundable chrono dates and times |
| `jiff`       | `hegel::extras::jiff`       | typed, boundable jiff dates and times   |
| `serde_json` | `hegel::extras::serde_json` | `values()` for bounded JSON trees       |
| `rand`       | `hegel::extras::rand`       | `rand` integration                      |

The `static-engine` feature links the engine statically instead of loading `libhegel_c` at runtime. Enable it for test or `#[hegel::main]` binaries that run outside cargo, for statically linked musl targets, and for builds without access to crates.io (the build script otherwise fetches the pinned engine source). The alternative is `HEGEL_C_LIB_DIR` pointing at a prebuilt library of the exact matching version.

---

# 7. Runner Configuration & CI Policy

## 7.1 Default Local Run

```rust
#[hegel::test]  // defaults to 100 test cases
fn test_property(tc: TestCase) { ... }
```

Override via attribute:

```rust
#[hegel::test(test_cases = 256)]
fn test_property(tc: TestCase) { ... }
```

---

## 7.2 Profiles and `hegel.toml`

Set suite-wide defaults in a `hegel.toml` at the package or workspace root, not in every attribute. Hegel ships three profiles: `development` (local runs), `ci` (selected automatically on CI servers), and `workload` (inside Antithesis). A section for a shipped profile merges onto it. A custom profile layers on top of whichever profile the environment selects, unless it sets `extends`:

```toml
default = "nightly"   # optional: default profile for this project

[profiles.ci]
test_cases = 1000

[profiles.nightly]    # nightly -> ci on CI, nightly -> development locally
test_cases = 10000
```

Select a profile for one test with `#[hegel::test(profile = "nightly")]`, for a run with `HEGEL_DEFAULT_PROFILE=nightly cargo test`, or in code with `Settings::from_profile("nightly")`. Keys in `hegel.toml` use snake_case values (`suppress_health_check = ["too_slow"]`, `database = "disabled"`), and an unknown key is an error.

---

## 7.3 Settings

Configure via attribute or `Settings` object:

```rust
#[hegel::test(test_cases = 500, derandomize = true)]
fn test_deterministic(tc: TestCase) { ... }

// Or programmatically:
hegel::Hegel::new(|tc: hegel::TestCase| {
    let x = tc.draw(gs::integers::<i32>());
    assert!(x + 0 == x);
})
.settings(hegel::Settings::new().test_cases(500))
.run();
```

Every `key = value` pair in the attribute becomes a call to the `Settings` method of the same name. You can also pass a whole `Settings` expression first: `#[hegel::test(my_settings(), seed = Some(42))]`.

Available settings:

- `test_cases(n)` — number of test cases (default 100)
- `verbosity(Verbosity::Normal)` — `Quiet`, `Normal`, `Verbose`, `Debug`
- `seed(Some(42))` — fixed seed for reproducibility
- `derandomize(true)` — deterministic seed from test name (on in the `ci` profile)
- `database(None)` — disable the on-disk example database (default location `.hegel/examples`), or `Some(path)` to relocate it
- `phases([...])` — subset of `Phase::{Explicit, Reuse, Generate, Target, Shrink}` (default: all)
- `suppress_health_check([...])` — suppress specific health checks; replaces earlier suppressions instead of adding to them
- `print_blob(bool)` — print a `#[hegel::reproduce_failure("…")]` line on failure (default `true`)
- `show_statistics(true)` — print the `tc.event` statistics report at the end of the run
- `report_multiple_failures(true)` — report each distinct failure instead of only the first (default `false`)

Health checks: `FilterTooMuch`, `TooSlow`, `TestCasesTooLarge`, `LargeInitialTestCase`. `HealthCheck::all()` returns all four. A test case may make up to 2^20 choices; suppressing `TestCasesTooLarge` removes that limit.

Settings layer in this order, each overriding the one before: base defaults → profile (shipped, `hegel.toml`, or registered) → environment variables → values written in the test (attribute arguments or `Settings` builder calls).

`Settings::backend(Backend::Urandom)` exists for Antithesis workloads. Do not use it in ordinary test suites.

---

## 7.4 CI Behavior and Environment Variables

On a CI server (detected from `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, and similar variables), the `ci` profile applies:

- Database is disabled (no persistent state between runs)
- Tests are derandomized (reproducible across runs)
- `TooSlow` is suppressed
- Failures print a `reproduce_failure` blob, which is the only way to replay a CI failure locally

Override settings for one run without editing code:

| Variable                | Effect                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `HEGEL_TEST_CASES`      | `test_cases`, for tests that do not set it themselves       |
| `HEGEL_SEED`            | `seed` (an integer, or `none`)                              |
| `HEGEL_DERANDOMIZE`     | `derandomize` (`true`/`false`)                              |
| `HEGEL_DATABASE`        | database path, or `disabled`                                |
| `HEGEL_PRINT_BLOB`      | `print_blob`                                                |
| `HEGEL_STATISTICS`      | turns on `show_statistics`                                  |
| `HEGEL_DEFAULT_PROFILE` | default profile                                             |
| `HEGEL_CONFIG`          | path to `hegel.toml` when tests run outside the source tree |

For a deep exploration run: `HEGEL_TEST_CASES=10000 cargo test`.

---

## 7.5 Reproducing Failures

- **Example database**: failing examples are saved locally and replayed first on the next run (the `Reuse` phase). The database is not stable across hegel upgrades.
- **Failure blobs**: by default a failure prints a line to paste **below** `#[hegel::test]`:

  ```rust
  #[hegel::test]
  #[hegel::reproduce_failure("AAEC…")]
  fn my_test(tc: TestCase) { ... }
  ```

  Only the first `reproduce_failure` attribute replays. A blob is valid only for the hegel version that produced it, so do not commit it as a long-lived regression test.

- **Explicit test cases**: to pin a regression permanently, use `#[hegel::explicit_test_case]` with the draw variable names:

  ```rust
  #[hegel::test]
  #[hegel::explicit_test_case(x = 42, y = String::from("hello"))]
  fn my_test(tc: TestCase) {
      let x: i32 = tc.draw(gs::integers());
      let y: String = tc.draw(gs::text());
      // ...
  }
  ```

  Each value must have exactly the drawn type (`String::from("hello")`, not `"hello"`), or the test panics with a type mismatch. Repeated draws of the same name take suffixes: `x_1 = 1, x_2 = 2`.

  The explicit case must supply a value for **every** named draw in the body. The body is also compiled against an `ExplicitTestCase`, which only supports `draw`, `draw_silent`, `assume`, `reject`, `note` and `target`. A test that calls `draw_named`, `event` or `event_value` cannot use `explicit_test_case`, so keep explicit cases on small, focused tests.

---

# 8. Model-Based Stateful Testing Pattern

Hegel has built-in stateful testing via `#[hegel::state_machine]`:

```rust
use hegel::TestCase;
use hegel::generators as gs;

struct StackModel {
    sut: MyStack,
    model: Vec<u8>,
}

#[hegel::state_machine]
impl StackModel {
    #[rule]
    fn push(&mut self, tc: TestCase) {
        let val: u8 = tc.draw(gs::integers());
        self.sut.push(val);
        self.model.push(val);
    }

    #[rule]
    fn pop(&mut self, tc: TestCase) {
        tc.assume(!self.model.is_empty());
        let sut_val = self.sut.pop();
        let model_val = self.model.pop();
        assert_eq!(sut_val, model_val);
    }

    #[invariant]
    fn lengths_match(&self, _tc: TestCase) {
        assert_eq!(self.sut.len(), self.model.len());
    }
}

#[hegel::test]
fn test_stack_model(tc: TestCase) {
    let system = StackModel {
        sut: MyStack::new(),
        model: Vec::new(),
    };
    hegel::stateful::machine(system).steps(100).run(tc);
}
```

- `#[rule]` and `#[invariant]` methods can take `&self` or `&mut self`.
- `machine(m).run(tc)` runs up to 50 steps per test case by default. Change it with `.steps(n)`.
- `#[rule(weight = 5)]` makes a rule more likely to be chosen (default weight 1). This is a hint, not a guarantee.
- A plain `#[invariant]` runs in full on the initial and final states and is **sampled** between steps. A violation that a later rule undoes can be missed. Use `#[invariant(always_run)]` for invariants that must see every intermediate state.
- Put `tc.assume(...)` and filtered draws at the **start** of a rule. Rejection does not roll back what the rule already did.

For value pools in stateful tests, use `hegel::stateful::Pool<T>`. Do not read the pool directly. Draw through one of its two generators so that the choice is recorded and shrinks:

- `pool.values_reusable()` — yields `&T` and leaves the value in the pool
- `pool.values_consumed()` — yields `T` and removes it from the pool

Both reject the test case when the pool is empty.

```rust
use hegel::stateful::{Pool, pool};

struct MyTest {
    pool: Pool<String>,
}

#[hegel::state_machine]
impl MyTest {
    #[rule]
    fn add(&mut self, tc: TestCase) {
        let s = tc.draw(gs::text().min_size(1));
        self.pool.add(s);
    }

    #[rule]
    fn use_value(&mut self, tc: TestCase) {
        let val: &String = tc.draw(self.pool.values_reusable());
        assert!(!val.is_empty());
    }

    #[rule]
    fn remove_value(&mut self, tc: TestCase) {
        let val: String = tc.draw(self.pool.values_consumed());
        assert!(!val.is_empty());
    }
}

#[hegel::test]
fn test_pool(tc: TestCase) {
    let test = MyTest { pool: pool(&tc) };
    hegel::stateful::machine(test).run(tc);
}
```

For concurrent systems, `#[hegel::concurrent_state_machine]` runs rules from several worker threads. Its rules take `&self`, it uses `ConcurrentPool` (`concurrent_pool(&tc)`), and it runs with `machine(m).max_concurrency(4).run_concurrent(tc)`.

---

# 9. Feature-Aware Coverage Pattern

When inputs have discrete features:

```rust
#[derive(DefaultGenerator, Debug, Clone, Copy, Hash, Eq, PartialEq)]
enum Mode { A, B, C }

#[hegel::test(test_cases = 1000)]
fn test_coverage(tc: TestCase) {
    let mode: Mode = tc.draw(gs::default());
    let flag: bool = tc.draw(gs::booleans());

    // exercise code under different mode/flag combinations
    let result = process(mode, flag);
    assert!(result.is_valid());
}
```

Record `tc.event(&format!("{mode:?}/{flag}"))` and run with `HEGEL_STATISTICS=1` to confirm every combination is actually reached.

Use in extended runs only.

---

# 10. Anti-Patterns

1. Tautological properties
2. Checking trivial invariants only
3. Massive rejection (too many `tc.assume(false)` calls)
4. Non-deterministic test body
5. Only testing "does not panic"
6. Adding `#[test]` alongside `#[hegel::test]` (hegel adds it automatically)
7. Adding `.print_as_debug()` to draws that already print, or returning `-> impl Generator<T>` from helpers (use `-> impl PrintableGenerator<T>`)
8. Committing `reproduce_failure` blobs as permanent regression tests (use `explicit_test_case`)

---

# 11. Golden Template: Differential Property

```rust
#[cfg(test)]
mod tests {
    use hegel::TestCase;
    use hegel::DefaultGenerator;
    use hegel::generators as gs;

    #[derive(DefaultGenerator, Debug)]
    struct Input {
        n: u32,
        bytes: Vec<u8>,
    }

    fn reference(n: u32, bytes: &[u8]) -> u32 {
        n.wrapping_add(bytes.iter().map(|&b| b as u32).sum::<u32>())
    }

    fn sut(n: u32, bytes: &[u8]) -> u32 {
        reference(n, bytes)
    }

    #[hegel::test(test_cases = 1000)]
    fn prop_matches_reference(tc: TestCase) {
        let i: Input = tc.draw(
            gs::default::<Input>()
                .n(gs::integers().min_value(0_u32).max_value(10_000))
                .bytes(gs::vecs(gs::integers::<u8>()).max_size(128))
        );
        assert_eq!(sut(i.n, &i.bytes), reference(i.n, &i.bytes));
    }
}
```

---

# 12. Golden Template: Round-Trip Property

```rust
#[hegel::test]
fn prop_round_trip(tc: hegel::TestCase) {
    let data: Vec<u8> = tc.draw(gs::vecs(gs::integers::<u8>()));
    let encoded = encode(&data);
    let decoded = decode(&encoded).unwrap();
    assert_eq!(decoded, data);
}
```

---

# 13. Golden Template: Algebraic Law

```rust
#[hegel::test]
fn prop_add_commutative(tc: hegel::TestCase) {
    let a: i32 = tc.draw(gs::integers());
    let b: i32 = tc.draw(gs::integers());
    assert_eq!(a + b, b + a);
}
```

Only use when meaningful.

---

# 14. Engineering Checklist Before Merging

- [ ] Do properties encode real behavior?
- [ ] Are inputs valid by construction?
- [ ] Is rejection minimal?
- [ ] Does shrinking produce understandable counterexamples?
- [ ] Is CI configured with reasonable `test_cases` counts?
- [ ] Is test body deterministic?

---

# 15. Philosophy

Property testing is not about randomness.

It is about:

- Encoding specifications
- Exploring structured input spaces
- Producing minimal, actionable counterexamples
- Catching bugs that example tests miss

Design properties like you design APIs:

- Carefully
- Explicitly
- With invariants first

---

# 16. Versioning

This skill assumes:

- `hegeltest` 0.47.x (crate name on crates.io, lib name `hegel`)
- Rust edition 2024, minimum rust-version 1.86
- Runtime: no Python or `uv`. The engine ships as `libhegel_c`, which the build script compiles and tests load at runtime. Use the `static-engine` feature for standalone or offline builds (§6.5). The `native` and `antithesis` features were removed; do not enable them.

Hegel is in beta, and minor versions can contain breaking changes. Revisit this skill when you bump the minor version. The example database and `reproduce_failure` blobs are not stable across versions.
