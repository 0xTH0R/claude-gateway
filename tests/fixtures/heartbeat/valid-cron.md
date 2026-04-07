tasks:
  - name: morning-brief
    cron: "0 8 * * *"
    prompt: "Give Max a brief morning summary."
  - name: weekly-review
    cron: "0 18 * * 5"
    prompt: "Prepare weekly review."

# Behaviour
- Reply HEARTBEAT_OK if nothing needs attention.
