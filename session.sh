#!/usr/bin/env python3
# ==============================================================================
# Antigravity Interactive Session Launcher for This Project
# ==============================================================================

import os
import sys
import json
import re

CURRENT_DIR = os.getcwd()
PROJECT_NAME = os.path.basename(CURRENT_DIR)
BRAIN_DIR = os.path.expanduser("~/.gemini/antigravity-cli/brain")
BASE_DIR = "/home/talha/Desktop/Laravel-Projects/"

C_CYAN = "\033[1;36m"
C_GREEN = "\033[1;32m"
C_YELLOW = "\033[1;33m"
C_BOLD = "\033[1m"
C_RESET = "\033[0m"
C_DIM = "\033[2m"

def get_session_info(t_path):
    created = "Unknown"
    topic = "—"
    detected_project = "Unknown"

    try:
        with open(t_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    data = json.loads(line)
                    if "created_at" in data and created == "Unknown":
                        created = data["created_at"][:10]

                    if data.get("type") == "USER_INPUT" and topic == "—":
                        cnt = data.get("content", "")
                        m = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", cnt, re.DOTALL)
                        if m:
                            clean = m.group(1).strip().replace("\n", " ")
                            topic = (clean[:55] + "...") if len(clean) > 55 else clean

                    if BASE_DIR in line and detected_project == "Unknown":
                        idx = line.find(BASE_DIR)
                        rest = line[idx + len(BASE_DIR):]
                        end_chars = ["/", "\"", "\x27", "\\"]
                        end_pos = len(rest)
                        for ec in end_chars:
                            p = rest.find(ec)
                            if p != -1 and p < end_pos:
                                end_pos = p
                        cand = rest[:end_pos].strip()
                        if cand and cand != "list-sessions.sh":
                            detected_project = cand
                except:
                    pass
    except:
        pass

    return created, topic, detected_project

matched_sessions = []

if os.path.exists(BRAIN_DIR):
    for conv_id in os.listdir(BRAIN_DIR):
        t_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript.jsonl")
        if not os.path.exists(t_path):
            continue

        created, topic, detected_proj = get_session_info(t_path)
        if detected_proj == PROJECT_NAME:
            matched_sessions.append({
                "id": conv_id,
                "date": created,
                "topic": topic
            })

# Sort newest first
matched_sessions.sort(key=lambda x: x["date"], reverse=True)

print(f"\n{C_CYAN}========================================================================{C_RESET}")
print(f"  {C_BOLD}Antigravity Project Session:{C_RESET} {C_GREEN}{PROJECT_NAME}{C_RESET}")
print(f"{C_CYAN}========================================================================{C_RESET}")

if matched_sessions:
    print(f"Found {len(matched_sessions)} previous chat(s) for this project:\n")
    for idx, s in enumerate(matched_sessions, 1):
        print(f"  {C_YELLOW}[{idx}]{C_RESET} Date: {s['date']} | ID: {C_CYAN}{s['id']}{C_RESET}")
        print(f"      Topic: {C_DIM}{s['topic']}{C_RESET}\n")
else:
    print(f"{C_DIM}No previous conversations found for this project yet.{C_RESET}\n")

print(f"  {C_GREEN}[n]{C_RESET} Start a {C_BOLD}NEW{C_RESET} conversation in this project")
print(f"  {C_DIM}[q] Quit{C_RESET}\n")

try:
    choice = input(f"{C_BOLD}Select an option to open [1-{len(matched_sessions)}/n/q]: {C_RESET}").strip().lower()
except (KeyboardInterrupt, EOFError):
    print("\nExiting.")
    sys.exit(0)

if choice == "q" or choice == "":
    print("Cancelled.")
    sys.exit(0)
elif choice == "n":
    print(f"\n{C_GREEN}Starting NEW conversation for {PROJECT_NAME}...{C_RESET}")
    os.execvp("agy", ["agy"])
elif choice.isdigit():
    num = int(choice)
    if 1 <= num <= len(matched_sessions):
        target = matched_sessions[num - 1]
        print(f"\n{C_CYAN}Resuming conversation {target['id']}...{C_RESET}")
        os.execvp("agy", ["agy", "--conversation", target["id"]])
    else:
        print(f"Invalid number. Please select between 1 and {len(matched_sessions)}.")
else:
    print("Invalid choice.")
