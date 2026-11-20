spec "sales_machine" {
  product  = "<ProductName>"
  version  = "1.0.0"
  operator = agent.operator
  note     = "Specification only. Not infrastructure. Nothing here is executed."
}

agent "operator" {
  purpose      = "Runs the routines, drafts, audits and hands off to people"
  reads        = [source.product, source.access_requests, source.usage]
  writes       = ["sales-machine/"]
  never        = [rule.no_publish_without_review, rule.never_say]
  escalates_to = role.sales
}

role "sales" {
  owns     = ["assisted invites", "leads", "closing"]
  approves = [handoff.lead]
}

source "access_requests" {
  kind            = "form"
  path_or_channel = "<channel>"
  refresh         = "on event"
}

event "access_requested" {
  captures = ["goal", "company", "providers", "referrer"]
}

stage "attract" {
  order  = 2
  entry  = event.access_requested
  exit   = event.invite_sent
  value  = ["Vision", "Time savings", "Reduced anxiety"]
  metric = metric.request_to_invite
  owner  = role.sales
}

lane "self_serve" {
  path   = ["first use", "own setup", "schedule", "connect an agent"]
  signal = signal.self_serve_usage
}

signal "self_serve_usage" {
  when = "[to confirm: N uses in 30 days]"
  then = workflow.lead_handoff
}

loop "integrations" {
  steps  = ["customer names its providers", "we integrate", "integration page attracts their customers", "they name theirs"]
  owner  = role.product
  metric = metric.requests_per_cohort
  feeds  = stage.feed
}

workflow "article_batch" {
  inputs = [source.product, "articles/index.json"]

  step "pick_gaps" {
    does = "Coverage persona x stage x loop x value; pick the gaps"
  }

  step "draft" {
    does = "Write ready articles with value, loop, CTA and FAQ"
    uses = [rule.cta, rule.never_say]
  }

  outputs     = ["articles/<date>/*.md"]
  review_gate = gate.content
}

routine "daily_articles" {
  schedule    = "daily 19:00 <tz>"
  agent       = agent.operator
  runs        = workflow.article_batch
  delivers_to = handoff.articles
}

gate "content" {
  checks  = ["only ledger facts", "2-4 value elements", "loop hook", "FAQ", "no forbidden CTA"]
  on_fail = "fix, or record FAIL and hand off"
}

metric "request_to_invite" {
  formula = "invites_sent / access_requests"
  per     = "100 access requests"
}

rule "cta" {
  text = "Every call to action is the configured primary CTA"
}

handoff "articles" {
  from     = agent.operator
  to       = role.content
  artifact = "articles/<date>/*.md"
  when     = "after gate.content passes"
}

# Blocks referenced above, declared so this example resolves on its own.

role "content" {
  owns     = ["articles", "pages", "tone"]
  approves = [handoff.articles]
}

role "product" {
  owns = ["in-app path", "onboarding", "integrations"]
}

source "product" {
  kind            = "files"
  path_or_channel = "<product code and docs folder>"
  refresh         = "on release"
}

source "usage" {
  kind            = "events"
  path_or_channel = "<usage events channel>"
  refresh         = "daily"
}

event "invite_sent" {
  captures = ["lane", "invited_by"]
}

stage "feed" {
  order  = 1
  entry  = event.content_published
  exit   = event.access_requested
  value  = ["Vision", "Time savings"]
  metric = metric.requests_per_cohort
  owner  = role.content
}

event "content_published" {
  captures = ["persona", "stage", "loop"]
}

metric "requests_per_cohort" {
  formula = "new access requests / accounts activated in the month"
  per     = "monthly activated cohort"
}

rule "never_say" {
  text = "Nothing from config.neverSay or config.internalOnly"
}

rule "no_publish_without_review" {
  text = "The agent drafts and hands off; people publish"
}

workflow "lead_handoff" {
  inputs = [source.usage]

  step "build_lead" {
    does = "Goal, path and providers of the account that met the signal"
  }

  outputs     = ["lead note"]
  review_gate = gate.lead
}

gate "lead" {
  checks  = ["signal met", "no customer data outside the lead note"]
  on_fail = "hold and report"
}

handoff "lead" {
  from     = agent.operator
  to       = role.sales
  artifact = "lead note"
  when     = "after gate.lead passes"
}
