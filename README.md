# Packet Logger Mod for TeraAtlas

This mod intercepts and logs all network packets between the TERA client and server.
Uses info from current toolbox / patch version to parse data from packets into the log file.

## Features

*   **In-Game Logging:** Prints basic packet information (Direction, Name, Opcode) to the private Toolbox chat channel (`/8`).
*   **File Logging:** Creates a detailed, timestamped log file for each session in the `mods/packet-logger/logs/` directory. Logs include timestamp, direction, opcode, name, and either parsed packet data (if known) or raw hexadecimal data.
*   **Filtering:** Allows filtering logged packets based on their name, with support for multiple filters simultaneously.
*   **Configurable Output:** Ability to toggle logging to in-game text and/or log file independently.
*   **Item and Skill Logging:** Logs item and skill usage with both IDs and names to game chat and/or log file.
*   **Equipment Logging:** Logs equipment-related packets such as equipping items, servant items, and pet items.
*   **Extended Skill Logging:** Captures additional skill-related packets like skill results, action stages, and action end events.
*   **Real/Fake Packet Identification:** Clearly identifies whether packets are real (from the game) or fake (from mods).
*   **Debug Mode:** Optional debug logging for troubleshooting, which can be toggled on/off.

## Commands

Commands are entered in the Toolbox private chat channel (usually accessed with `/8` in game).

*   **`pktlog <filter_text>`**: Toggles a packet filter. If the filter doesn't exist, it adds it. If it already exists, it removes it.
    *   Example: `/8 pktlog SKILL` - Adds a filter for packets with "SKILL" in their name.
    *   Example: `/8 pktlog ABNORMALITY` - Adds another filter for abnormality-related packets.
    *   Running the same command again removes that specific filter.
*   **`pktlog`**: Removes all packet filters. All packets will be logged.
*   **`pktlogfake`**: Toggles the logging of "fake" packets (packets sent by mods themselves). By default, fake packets are *not* logged. When enabled, fake packets will have a `[FAKE]` prefix in the logs.
*   **`pktloggame`**: Toggles logging packets to in-game text.
*   **`pktlogfile`**: Toggles logging packets to the log file.
*   **`itemskillgame`**: Toggles logging item and skill usage to in-game text. When enabled, displays item/skill names and IDs when used.
*   **`itemskillfile`**: Toggles logging item and skill usage to a separate log file.
*   **`equipgame`**: Toggles logging equipment-related packets to in-game text. When enabled, displays equipment changes with names and IDs.
*   **`equipfile`**: Toggles logging equipment-related packets to a separate log file.
*   **`pktdebug`**: Toggles debug mode on/off. When enabled, detailed debug information is logged to the console.

## Log File Location

Log files are saved in: `[TeraAtlas Directory]/mods/packet-logger/logs/`

Each packet log file is named with a timestamp corresponding to when the session started, e.g., `packets_1744764281000.log`.

Item and skill usage logs are saved in a separate file with a similar naming convention: `item_skill_log_1744764281000.log`.

## Item and Skill Logging

When enabled, this mod will:
* Display item and skill usage in game chat with both name and ID
* Clearly indicate whether packets are REAL (from the game) or FAKE (from mods)
* Log item and skill usage to a separate log file with timestamp, ID, and name information
* For items, it attempts to retrieve the actual item name from the game data
* For skills, it displays the skill ID and base skill ID

## Equipment Logging

When enabled, this mod will:
* Display equipment-related packets in game chat with both name and ID
* Log equipment changes to a separate log file with timestamp, ID, and name information
* Track various equipment actions including:
  * Regular item equipping (C_EQUIP_ITEM, S_EQUIP_ITEM)
  * Servant item equipping (C_EQUIP_SERVANT_ITEM, S_EQUIP_SERVANT_ITEM)
  * Pet equipment (C_PET_EQUIP)
  * Equipment inheritance (C_REQUEST_EQUIPMENT_INHERITANCE)
  * Equipment change notifications (S_USER_ITEM_EQUIP_CHANGER)

## Extended Skill Logging

In addition to basic skill usage, this mod now tracks:
* Skill results (S_EACH_SKILL_RESULT)
* Action end events (S_ACTION_END)
* Action stage events (S_ACTION_STAGE)

This provides more comprehensive information about skill execution and effects.

## Monitored Packet Types

This mod specifically monitors the following packet types:

### Item Usage Packets
* `C_USE_ITEM` - Client using an item

### Skill Usage Packets
* `C_START_SKILL` - Client starting a skill
* `C_PRESS_SKILL` - Client using a press-type skill
* `C_START_TARGETED_SKILL` - Client using a targeted skill
* `C_START_COMBO_INSTANT_SKILL` - Client using a combo instant skill
* `C_NOTIMELINE_SKILL` - Client using a no-timeline skill
* `S_EACH_SKILL_RESULT` - Server reporting skill result
* `S_ACTION_END` - Server reporting skill action end
* `S_ACTION_STAGE` - Server reporting skill action stage
* `S_START_COOLTIME_SKILL` - Server reporting skill cooldown start

### Equipment Packets
* `C_EQUIP_ITEM` - Client equipping an item
* `C_EQUIP_SERVANT_ITEM` - Client equipping an item on a servant
* `C_PET_EQUIP` - Client equipping an item on a pet
* `C_REQUEST_EQUIPMENT_INHERITANCE` - Client requesting equipment inheritance
* `S_EQUIP_ITEM` - Server confirming item equip
* `S_EQUIP_SERVANT_ITEM` - Server confirming servant item equip
* `S_USER_ITEM_EQUIP_CHANGER` - Server notifying about item equip change
* `S_OBTAIN_TOKEN_ITEM` - Server reporting token item obtained
* `S_PREVIEW_ITEM` - Server sending item preview
* `S_RECEIVE_TOKEN_TARGET_ITEM` - Server reporting token target item received
* `S_RESULT_COMBINE_ITEM` - Server reporting item combination result
* `S_RESULT_REPAIR_ITEM` - Server reporting item repair result
* `S_SEND_QUEST_ITEM_INFO` - Server sending quest item info
* `S_SET_SEND_PARCEL_ITEM` - Server setting parcel item
* `S_SHOW_TRADE_ITEM` - Server showing trade item
* `S_USE_RIGHT_ITEM` - Server using right item
* `S_START_COOLTIME_ITEM` - Server reporting item cooldown start

In addition to these specific packet types, the mod can also log all packet types when no filters are applied.

## Credits

Written by merusira.

## FIN