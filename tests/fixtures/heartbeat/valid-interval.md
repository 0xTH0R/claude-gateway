tasks:
  - name: idle-checkin
    interval: 2h
    prompt: "Check if anything needs attention."
  - name: half-hour-ping
    interval: 30m
    prompt: "Quick status check."

# Behaviour
- Reply HEARTBEAT_OK if nothing needs attention.
