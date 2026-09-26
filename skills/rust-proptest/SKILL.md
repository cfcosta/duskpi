---
name: rust-proptest
description: Teaches the LLM how to do property tests correctly in rust
---

## 0. Purpose

This skill teaches an LLM how to design and implement **high-leverage, reproducible property-based tests (PBT)** in Rust using:

- `hegeltest` (crate name on crates.io, lib name `hegel`) for generators, shrinking, and test execution.

Hegel is based on Hypothesis. It runs entirely in-process: a native Rust port of the Hypothesis engine generates and shrinks test data. There is no Python dependency, no `hegel-core` server, and no `uv` install. Add it with `cargo add --dev hegeltest`.

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
   - Hegel auto-detects CI (GitHub Actions, GitLab CI, CircleCI, etc.)
   - In CI: database is disabled and tests are derandomized by default
   - Recommend `test_cases` counts via the attribute

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
- Compare state after each step

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
fn sorted_unique_vec(tc: hegel::TestCase) -> Vec<u32> {
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

If rejection count grows, redesign the generator. Hegel will raise a `FilterTooMuch` health check if too many test cases are rejected.

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
fn small_vec_u8(tc: hegel::TestCase) -> Vec<u8> {
    tc.draw(gs::vecs(gs::integers::<u8>()).max_size(64))
}
```

Reuse across tests via `tc.draw(small_vec_u8())`.

---

# 5. Hegel API Usage Rules

## 5.1 Basic Test Structure

Every hegel test takes a `TestCase` parameter and draws values explicitly:

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

- `tc.draw(generator)` — draw a value (requires `T: Debug`)
- `tc.draw_silent(generator)` — draw without recording (no `T: Debug` needed)
- `tc.assume(condition)` — reject the current test case if false
- `tc.reject()` — reject unconditionally; returns `!`
- `tc.note(&str)` — attach debug info shown only on failure replay
- `tc.target(score: f64)` — steer generation toward inputs that maximise `score` (inside `#[hegel::test]`, the source expression becomes the label; use `tc.target_labelled(score, label)` to set it explicitly)
- `tc.repeat(|| { ... })` — run a body "logically forever" until the test case ends; each iteration is noted in the failure replay

`TestCase` is `Send` but not `Sync`. You can `tc.clone()` it and draw from the clone on another thread. Each clone draws from its own deterministic stream, and all clones share one outcome. Join every such thread before the test returns.

`#[hegel::test]` rewrites `let x = tc.draw(...)` so that failures print `let x = <value>;` with real variable names.

---

## 5.3 Deriving DefaultGenerator

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

Note: `hegel::DefaultGenerator` is the derive macro; `hegel::generators::DefaultGenerator` is the trait. `gs::default::<T>()` returns `T::Generator` directly (it is not boxed), so builder methods stay available.

Customize specific fields by chaining builder methods on `gs::default::<T>()`:

```rust
let i: Input = tc.draw(
    gs::default::<Input>()
        .n(gs::integers().min_value(0_u32).max_value(10_000))
        .bytes(gs::vecs(gs::integers::<u8>()).max_size(128))
);
```

---

## 5.4 Enum Generation

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

`#[derive(DefaultGenerator)]` also works on generic types (`struct Point<T> { x: T }` works for any `T: DefaultGenerator`). Lifetime parameters are not supported.

---

## 5.5 Foreign Type Generation

For types you don't own, use `derive_generator!`:

```rust
hegel::derive_generator!(ForeignStruct {
    field1: String,
    field2: u32,
});

// Now gs::default::<ForeignStruct>() works, and so does
// gs::default::<ForeignStruct>().field1(gen) for customized fields.
```

---

## 5.6 Dependent Generation

Use `#[hegel::composite]` or `hegel::compose!` for values that depend on each other:

```rust
#[hegel::composite]
fn range_input(tc: hegel::TestCase) -> (u32, u32) {
    let lo: u32 = tc.draw(gs::integers().min_value(0_u32).max_value(1000));
    let hi: u32 = tc.draw(gs::integers().min_value(lo).max_value(lo + 100));
    (lo, hi)
}
```

Or inline with `compose!`:

```rust
let (lo, hi) = tc.draw(hegel::compose!(|tc| {
    let lo: u32 = tc.draw(gs::integers().min_value(0_u32).max_value(1000));
    let hi: u32 = tc.draw(gs::integers().min_value(lo).max_value(lo + 100));
    (lo, hi)
}));
```

---

## 5.7 Combinators

Choose from multiple generators:

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

## 5.8 Generator Combinators

All generators support these methods. They live on the `Generator` trait, so bring it into scope with `use hegel::generators::Generator;` (also re-exported as `hegel::Generator`):

```rust
gen.map(|x| transform(x))         // transform output
gen.flat_map(|x| another_gen(x))   // dependent generation
gen.filter(|x| predicate(x))      // filter (retries 3 times, then assume(false))
gen.boxed()                        // type-erase into BoxedGenerator
```

`.filter()` on a generator with a finite value set (e.g. `sampled_from`) enumerates the valid values once instead of rejection-sampling. An unsatisfiable filter is a usage error.

---

## 5.9 Recursive Generators

Use `gs::deferred::<T>()` to refer to a generator before it is defined:

```rust
use hegel::generators::{self as gs, Generator};

enum Tree {
    Leaf(i32),
    Branch(Box<Tree>, Box<Tree>),
}

let tree = gs::deferred::<Tree>();
let leaf = gs::integers::<i32>().map(Tree::Leaf);
let branch = hegel::tuples!(tree.generator(), tree.generator())
    .map(|(l, r)| Tree::Branch(Box::new(l), Box::new(r)));
tree.set(hegel::one_of!(leaf, branch));
```

---

## 5.10 Misconfiguration Is a Usage Error

Invalid generator arguments (`max_value` below `min_value`, an empty `sampled_from`/`one_of`, a `hashsets` `min_size` larger than the element generator's distinct values, an unknown codec) abort the run with a clear message. They are not reported or shrunk as counterexamples.

---

# 6. Available Generators Reference

## 6.1 Primitives

| Function              | Type              | Builder Methods                                                                                                                                     |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gs::integers::<T>()` | all integer types | `.min_value(v)`, `.max_value(v)`                                                                                                                    |
| `gs::floats::<T>()`   | `f32`, `f64`      | `.min_value(v)`, `.max_value(v)`, `.allow_nan(bool)`, `.allow_infinity(bool)`, `.allow_subnormal(bool)`, `.exclude_min(bool)`, `.exclude_max(bool)` |
| `gs::booleans()`      | `bool`            | —                                                                                                                                                   |
| `gs::just(value)`     | `T`               | —                                                                                                                                                   |
| `gs::unit()`          | `()`              | —                                                                                                                                                   |
| `gs::durations()`     | `Duration`        | `.min_value(Duration)`, `.max_value(Duration)`                                                                                                      |

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

`codec` accepts `"ascii"` (same as `.max_codepoint(0x7F)`), `"latin-1"`/`"iso-8859-1"` (`.max_codepoint(0xFF)`), and `"utf-8"` (no-op). For typed, boundable dates and times, use the `chrono` or `jiff` extras (§6.5).

## 6.3 Collections

| Function                             | Type            | Builder Methods                                 |
| ------------------------------------ | --------------- | ----------------------------------------------- |
| `gs::vecs(element_gen)`              | `Vec<T>`        | `.min_size(n)`, `.max_size(n)`, `.unique(bool)` |
| `gs::hashsets(element_gen)`          | `HashSet<T>`    | `.min_size(n)`, `.max_size(n)`                  |
| `gs::hashmaps(key_gen, val_gen)`     | `HashMap<K, V>` | `.min_size(n)`, `.max_size(n)`                  |
| `gs::arrays::<_, _, N>(element_gen)` | `[T; N]`        | —                                               |

## 6.4 Combinators

| Function/Macro                    | Description                                  |
| --------------------------------- | -------------------------------------------- |
| `gs::optional(gen)`               | `Option<T>`                                  |
| `gs::sampled_from(values)`        | pick uniformly from a fixed list             |
| `gs::one_of(vec_of_boxed_gens)`   | choose from multiple generators              |
| `hegel::one_of!(g1, g2, ...)`     | macro that auto-boxes generators             |
| `hegel::tuples!(g1, g2, ...)`     | tuple generator (0 to 12 elements)           |
| `hegel::compose!(\|tc\| { ... })` | inline composed generator                    |
| `gs::deferred::<T>()`             | forward reference for recursive generators   |
| `gs::default::<T>()`              | the type's `DefaultGenerator`, with builders |

## 6.5 Extras (Cargo Features)

| Feature      | Module                      | Provides                                |
| ------------ | --------------------------- | --------------------------------------- |
| `chrono`     | `hegel::extras::chrono`     | typed, boundable chrono dates and times |
| `jiff`       | `hegel::extras::jiff`       | typed, boundable jiff dates and times   |
| `serde_json` | `hegel::extras::serde_json` | `values()` for bounded JSON trees       |
| `rand`       | `hegel::extras::rand`       | `rand` integration                      |

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

## 7.2 Extended Nightly

```rust
#[hegel::test(test_cases = 5000)]
fn test_property_extended(tc: TestCase) { ... }
```

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
- `stateful_step_count(n)` — max steps per stateful test case (default 50, minimum 1)
- `verbosity(Verbosity::Normal)` — `Quiet`, `Normal`, `Verbose`, `Debug`
- `seed(Some(42))` — fixed seed for reproducibility
- `derandomize(true)` — deterministic seed from test name (auto in CI)
- `database(None)` — disable the on-disk example database, or `Some(path)` to relocate it
- `phases([...])` — subset of `Phase::{Explicit, Reuse, Generate, Target, Shrink}` (default: all)
- `suppress_health_check([...])` — suppress specific health checks; replaces earlier suppressions instead of adding to them
- `print_blob(true)` — print a `#[hegel::reproduce_failure("…")]` line on failure (default `false`)
- `report_multiple_failures(true)` — report each distinct failure instead of only the first (default `false`)

Health checks: `FilterTooMuch`, `TooSlow`, `TestCasesTooLarge`, `LargeInitialTestCase`. `HealthCheck::all()` returns all four.

`Settings::backend(Backend::Urandom)` and `Settings::mode(Mode::SingleTestCase)` exist for Antithesis workloads. Do not use them in ordinary test suites.

---

## 7.4 CI Behavior

Hegel auto-detects CI environments and adjusts defaults:

- Database is disabled (no persistent state between runs)
- Tests are derandomized (reproducible across runs)

No additional environment variable configuration is needed.

---

## 7.5 Reproducing Failures

- **Example database**: failing examples are saved locally and replayed first on the next run (the `Reuse` phase). The database is not stable across hegel upgrades.
- **Failure blobs**: with `print_blob = true`, a failure prints a line to paste **below** `#[hegel::test]`:

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
    hegel::stateful::run(system, tc);
}
```

`#[rule]` and `#[invariant]` methods can take `&self` or `&mut self`. Invariants run after each successful rule. Set the step count with `#[hegel::test(stateful_step_count = 100)]`.

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
    hegel::stateful::run(test, tc);
}
```

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

Use in extended runs only.

---

# 10. Anti-Patterns

1. Tautological properties
2. Checking trivial invariants only
3. Massive rejection (too many `tc.assume(false)` calls)
4. Non-deterministic test body
5. Only testing "does not panic"
6. Adding `#[test]` alongside `#[hegel::test]` (hegel adds it automatically)
7. Committing `reproduce_failure` blobs as permanent regression tests (use `explicit_test_case`)

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

- `hegeltest` 0.28.x (crate name on crates.io, lib name `hegel`)
- Rust edition 2024, minimum rust-version 1.86
- Runtime: none. The engine is native Rust and runs in-process. There is no Python, `uv`, or `native` feature (that feature was removed; do not enable it).

Hegel is in beta, and minor versions can contain breaking changes. Revisit this skill when you bump the minor version.
