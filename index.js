'use strict';

const fs = require('fs');
const path = require('path');

// Helper to ensure log directory exists
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

// Replacer function to handle BigInt serialization for JSON.stringify
function bigIntReplacer(key, value) {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
}

module.exports = function PacketLogger(mod) {
    const command = mod.require ? mod.require.command : mod.command; // Handle legacy/core mod loading
    let logStream = null;
    
    // Reference settings directly instead of destructuring to ensure we always use the latest values
    
    // Track specifically hooked packets
    const hookedPackets = new Set();
    
    // Helper function for debug logging
    function debugLog(message) {
        if (mod.settings.debug) {
            mod.log(message);
        }
    }
    
    // Helper function to register a packet as hooked
    function registerHookedPacket(name) {
        if (name && name !== '*') {
            hookedPackets.add(name.toUpperCase());
            debugLog(`Registered hooked packet: ${name}`);
        }
    }
    
    const logDir = path.join(__dirname, 'logs');
    const logFileName = `packets_${Date.now()}.log`;
    const logFilePath = path.join(logDir, logFileName);
    
    // Create a separate log file for item and skill usage
    const itemSkillLogFileName = `item_skill_log_${Date.now()}.log`;
    const itemSkillLogFilePath = path.join(logDir, itemSkillLogFileName);
    let itemSkillLogStream = null;

    // --- Initialization ---
    try {
        ensureDirectoryExistence(logFilePath);
        logStream = fs.createWriteStream(logFilePath, { flags: 'a' }); // Append mode
        itemSkillLogStream = fs.createWriteStream(itemSkillLogFilePath, { flags: 'a' }); // Append mode
        mod.log(`Packet log file created: ${logFilePath}`);
        mod.log(`Item/Skill log file created: ${itemSkillLogFilePath}`);
    } catch (e) {
        mod.error('Failed to create log directory or file stream.');
        mod.error(e);
        // Mod can continue, but file logging will be disabled
    }

    // --- Packet Hook ---
    mod.hook('*', 'raw', { order: 10000 }, (code, data, incoming, fake) => { // Use high order to run after most other mods
        // Skip fake packets if logFakePackets is false
        if (fake && !mod.settings.logFakePackets) return;

        const timestamp = new Date().toISOString();
        const direction = incoming ? 'S->C' : 'C->S';
        const name = mod.dispatch.protocolMap.code.get(code) || 'UNKNOWN';

        // Check if we should only log hooked packets and if this packet is hooked
        if (mod.settings.logOnlyHookedPackets && name !== 'UNKNOWN') {
            const nameUpper = name.toUpperCase();
            if (!hookedPackets.has(nameUpper)) {
                return; // Skip logging if we're only logging hooked packets and this one isn't hooked
            }
        }

        // Apply filters
        if (mod.settings.packetFilters.length > 0) {
            // Check if any filter matches
            const nameUpper = name.toUpperCase();
            const matchesFilter = mod.settings.packetFilters.some(filter => nameUpper.includes(filter));
            if (!matchesFilter) {
                return; // Skip logging if filters are active and none match
            }
        }

        // Add [FAKE] prefix if logging fake packets
        const fakePrefix = fake ? '[FAKE] ' : '';

        // 1. In-Game Logging - Only log to game if explicitly requested with pktloggame command
        // and only if there are specific filters set (to avoid flooding chat with all packets)
        if (mod.settings.logPktToGame && mod.settings.packetFilters.length > 0) {
            command.message(`${fakePrefix}${direction} | ${name} (${code})`);
        }

        // 2. File Logging
        if (mod.settings.logPktToFile && logStream) {
            let logLine = `${timestamp} | ${fakePrefix}${direction} | ${code} | ${name}`;
            let event = null;

            if (name !== 'UNKNOWN') {
                try {
                    // Try to parse with the latest known definition
                    const latestVersion = mod.dispatch.latestDefVersion.get(name);
                    if (latestVersion !== undefined) {
                        event = mod.dispatch.fromRaw(name, latestVersion, data);
                    }
                } catch (e) {
                    // Parsing failed, log raw data instead
                    event = null;
                    // mod.warn(`Failed to parse ${name} (${code}): ${e.message}`); // Optional: Log parsing errors
                }
            }

            if (event) {
                // Safely stringify, handling potential circular references or large objects and BigInts
                try {
                    logLine += ` | ${JSON.stringify(event, bigIntReplacer)}`;
                } catch (stringifyError) {
                     logLine += ` | PARSED (Stringify Error: ${stringifyError.message})`;
                }
            } else {
                logLine += ` | RAW: ${data.toString('hex')}`;
            }

            logStream.write(logLine + '\n');
        }
    });
    // Item Usage
    // Register and hook C_USE_ITEM
    registerHookedPacket('C_USE_ITEM');
    mod.hook('C_USE_ITEM', 3, { order: 1000, filter: { fake: null } }, event => {
        // Log that we received an item use packet for debugging
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} C_USE_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
    
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Get item name if possible
            let itemName = "Unknown Item";
            try {
                // Try to get item data from game state
                if (mod.game.data && mod.game.data.items) {
                    const item = mod.game.data.items.get(event.id);
                    if (item && item.name) {
                        itemName = item.name;
                    }
                }
            } catch (e) {
                mod.warn(`Failed to get item name for ID ${event.id}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    debugLog(`Attempting to log ${fakeStatus} item to chat: ${itemName} (ID: ${event.id})`);
                    command.message(`${fakeStatus} C_USE_ITEM: ${itemName} (ID: ${event.id}, GameID: ${event.gameId}, DBID: ${event.dbid})`);
                    debugLog('Successfully logged item to chat');
                } catch (e) {
                    mod.error(`Failed to log item to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | C_USE_ITEM | ID: ${event.id} | Name: ${itemName} | GameID: ${event.gameId} | DBID: ${event.dbid}\n`);
            }
        }
        return true;
    });

    // Skill Usage - Use high order to ensure it runs after other mods
    // Register and hook C_START_SKILL
    registerHookedPacket('C_START_SKILL');
    mod.hook('C_START_SKILL', 7, { order: 1000, filter: { fake: null } }, event => {
        // Log that we received a skill packet for debugging
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} C_START_SKILL packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Skill";
            try {
                // Try to get skill name from system message
                // This is a simplified approach - in a full implementation, you might want to 
                // query skill data from the game client or use a predefined mapping
                skillName = `Skill ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    debugLog(`Attempting to log ${fakeStatus} skill to chat: ${skillName} (ID: ${skillId})`);
                    command.message(`${fakeStatus} C_START_SKILL: ${skillName} (ID: ${skillId})`);
                    debugLog('Successfully logged skill to chat');
                } catch (e) {
                    mod.error(`Failed to log skill to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | C_START_SKILL | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName}\n`);
            }
        }
        return true;
    });
    
    // Additional Skill Usage Hook - for press-type skills
    // Register and hook C_PRESS_SKILL
    registerHookedPacket('C_PRESS_SKILL');
    mod.hook('C_PRESS_SKILL', 4, { order: 1000, filter: { fake: null } }, event => {
        // Log that we received a press skill packet for debugging
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} C_PRESS_SKILL packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Press Skill";
            try {
                skillName = `Press Skill ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    debugLog(`Attempting to log ${fakeStatus} press skill to chat: ${skillName} (ID: ${skillId})`);
                    command.message(`${fakeStatus} C_PRESS_SKILL: ${skillName} (ID: ${skillId})`);
                    debugLog('Successfully logged press skill to chat');
                } catch (e) {
                    mod.error(`Failed to log press skill to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | C_PRESS_SKILL | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName}\n`);
            }
        }
        return true;
    });
    
    // Additional Skill Usage Hook - for targeted skills
    // Register and hook C_START_TARGETED_SKILL
    registerHookedPacket('C_START_TARGETED_SKILL');
    mod.hook('C_START_TARGETED_SKILL', 7, { order: 1000, filter: { fake: null } }, event => {
        // Log that we received a targeted skill packet for debugging
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} C_START_TARGETED_SKILL packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Targeted Skill";
            try {
                skillName = `Targeted Skill ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    debugLog(`Attempting to log ${fakeStatus} targeted skill to chat: ${skillName} (ID: ${skillId})`);
                    command.message(`${fakeStatus} C_START_TARGETED_SKILL: ${skillName} (ID: ${skillId})`);
                    debugLog('Successfully logged targeted skill to chat');
                } catch (e) {
                    mod.error(`Failed to log targeted skill to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | C_START_TARGETED_SKILL | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName}\n`);
            }
        }
        return true;
    });
    
    // Additional Skill Usage Hook - for combo instant skills
    // Register and hook C_START_COMBO_INSTANT_SKILL
    registerHookedPacket('C_START_COMBO_INSTANT_SKILL');
    mod.hook('C_START_COMBO_INSTANT_SKILL', 6, { order: 1000, filter: { fake: null } }, event => {
        // Log that we received a combo instant skill packet for debugging
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} C_START_COMBO_INSTANT_SKILL packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Combo Skill";
            try {
                skillName = `Combo Skill ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    debugLog(`Attempting to log ${fakeStatus} combo skill to chat: ${skillName} (ID: ${skillId})`);
                    command.message(`${fakeStatus} C_START_COMBO_INSTANT_SKILL: ${skillName} (ID: ${skillId})`);
                    debugLog('Successfully logged combo skill to chat');
                } catch (e) {
                    mod.error(`Failed to log combo skill to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | C_START_COMBO_INSTANT_SKILL | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName}\n`);
            }
        }
        return true;
    });
    
    // Additional Skill Usage Hook - for no-timeline skills
    // Register and hook C_NOTIMELINE_SKILL
    registerHookedPacket('C_NOTIMELINE_SKILL');
    mod.hook('C_NOTIMELINE_SKILL', 3, { order: 1000, filter: { fake: null } }, event => {
        // Log that we received a no-timeline skill packet for debugging
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} C_NOTIMELINE_SKILL packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown NoTimeline Skill";
            try {
                skillName = `NoTimeline Skill ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    debugLog(`Attempting to log ${fakeStatus} no-timeline skill to chat: ${skillName} (ID: ${skillId})`);
                    command.message(`${fakeStatus} C_NOTIMELINE_SKILL: ${skillName} (ID: ${skillId})`);
                    debugLog('Successfully logged no-timeline skill to chat');
                } catch (e) {
                    mod.error(`Failed to log no-timeline skill to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | C_NOTIMELINE_SKILL | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName}\n`);
            }
        }
        return true;
    });

    // --- Equipment-related Packet Hooks ---
    
    // C_EQUIP_ITEM - Client equipping an item
    try {
        // Register and hook C_EQUIP_ITEM
        registerHookedPacket('C_EQUIP_ITEM');
        mod.hook('C_EQUIP_ITEM', mod.dispatch.protocolVersion.C_EQUIP_ITEM || 2, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} C_EQUIP_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Item";
                try {
                    // Try to get item data from game state
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.id);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.id}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} C_EQUIP_ITEM: ${itemName} (ID: ${event.id}) to slot ${event.slot} | GameID: ${event.gameId} | Unk: ${event.unk}`);
                    } catch (e) {
                        mod.error(`Failed to log equipment to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | C_EQUIP_ITEM | ID: ${event.id} | Name: ${itemName} | Slot: ${event.slot} | GameID: ${event.gameId} | Unk: ${event.unk}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook C_EQUIP_ITEM: ${e.message}`);
    }
    
    // C_EQUIP_SERVANT_ITEM - Client equipping an item on a servant
    try {
        // Register and hook C_EQUIP_SERVANT_ITEM
        registerHookedPacket('C_EQUIP_SERVANT_ITEM');
        mod.hook('C_EQUIP_SERVANT_ITEM', mod.dispatch.protocolVersion.C_EQUIP_SERVANT_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} C_EQUIP_SERVANT_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Item";
                try {
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.itemId);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} C_EQUIP_SERVANT_ITEM: ${itemName} (ID: ${event.itemId}) on servant ${event.servantId}`);
                    } catch (e) {
                        mod.error(`Failed to log servant equipment to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | C_EQUIP_SERVANT_ITEM | ID: ${event.itemId} | Name: ${itemName} | ServantId: ${event.servantId}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook C_EQUIP_SERVANT_ITEM: ${e.message}`);
    }
    
    // C_PET_EQUIP - Client equipping an item on a pet
    try {
        // Register and hook C_PET_EQUIP
        registerHookedPacket('C_PET_EQUIP');
        mod.hook('C_PET_EQUIP', mod.dispatch.protocolVersion.C_PET_EQUIP || 3, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} C_PET_EQUIP packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Item";
                try {
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.itemId);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} C_PET_EQUIP: ${itemName} (ID: ${event.itemId}) on pet ${event.petId}`);
                    } catch (e) {
                        mod.error(`Failed to log pet equipment to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | C_PET_EQUIP | ID: ${event.itemId} | Name: ${itemName} | PetId: ${event.petId}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook C_PET_EQUIP: ${e.message}`);
    }
    
    // C_REQUEST_EQUIPMENT_INHERITANCE - Client requesting equipment inheritance
    try {
        // Register and hook C_REQUEST_EQUIPMENT_INHERITANCE
        registerHookedPacket('C_REQUEST_EQUIPMENT_INHERITANCE');
        mod.hook('C_REQUEST_EQUIPMENT_INHERITANCE', mod.dispatch.protocolVersion.C_REQUEST_EQUIPMENT_INHERITANCE || 2, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} C_REQUEST_EQUIPMENT_INHERITANCE packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} C_REQUEST_EQUIPMENT_INHERITANCE: Source item (${event.sourceItemUid}) to Target item (${event.targetItemUid})`);
                    } catch (e) {
                        mod.error(`Failed to log equipment inheritance to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | C_REQUEST_EQUIPMENT_INHERITANCE | Source: ${event.sourceItemUid} | Target: ${event.targetItemUid}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook C_REQUEST_EQUIPMENT_INHERITANCE: ${e.message}`);
    }
    
    // S_EQUIP_ITEM - Server confirming item equip
    // Register and hook S_EQUIP_ITEM
    registerHookedPacket('S_EQUIP_ITEM');
    mod.hook('S_EQUIP_ITEM', 1, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_EQUIP_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
            // Get item name if possible
            let itemName = "Unknown Item";
            try {
                if (mod.game.data && mod.game.data.items) {
                    const item = mod.game.data.items.get(event.id);
                    if (item && item.name) {
                        itemName = item.name;
                    }
                }
            } catch (e) {
                mod.warn(`Failed to get item name for ID ${event.id}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logEquipmentToGame) {
                try {
                    command.message(`${fakeStatus} S_EQUIP_ITEM: ${itemName} (ID: ${event.id}) equipped by CID: ${event.cid}, ItemID: ${event.itemid}`);
                } catch (e) {
                    mod.error(`Failed to log equipment to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_EQUIP_ITEM | ID: ${event.id} | Name: ${itemName} | CID: ${event.cid} | ItemID: ${event.itemid}\n`);
            }
        }
        return true;
    });
    
    // S_EQUIP_SERVANT_ITEM - Server confirming servant item equip
    try {
        // Register and hook S_EQUIP_SERVANT_ITEM
        registerHookedPacket('S_EQUIP_SERVANT_ITEM');
        mod.hook('S_EQUIP_SERVANT_ITEM', mod.dispatch.protocolVersion.S_EQUIP_SERVANT_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_EQUIP_SERVANT_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Item";
                try {
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.itemId);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_EQUIP_SERVANT_ITEM: ${itemName} (ID: ${event.itemId}) on servant ${event.servantId}`);
                    } catch (e) {
                        mod.error(`Failed to log servant equipment to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_EQUIP_SERVANT_ITEM | ID: ${event.itemId} | Name: ${itemName} | ServantId: ${event.servantId}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_EQUIP_SERVANT_ITEM: ${e.message}`);
    }
    
    // S_USER_ITEM_EQUIP_CHANGER - Server notifying about item equip change
    registerHookedPacket('S_USER_ITEM_EQUIP_CHANGER');
    mod.hook('S_USER_ITEM_EQUIP_CHANGER', 1, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_USER_ITEM_EQUIP_CHANGER packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
            // Log to game chat
            if (mod.settings.logEquipmentToGame) {
                try {
                    command.message(`${fakeStatus} S_USER_ITEM_EQUIP_CHANGER: User ${event.gameId} changed equipment`);
                } catch (e) {
                    mod.error(`Failed to log equipment change to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_USER_ITEM_EQUIP_CHANGER | GameId: ${event.gameId}\n`);
            }
        }
        return true;
    });
    
    // --- Additional Skill-related Packet Hooks ---
    
    // S_EACH_SKILL_RESULT - Server reporting skill result
    registerHookedPacket('S_EACH_SKILL_RESULT');
    mod.hook('S_EACH_SKILL_RESULT', 14, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_EACH_SKILL_RESULT packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Skill Result";
            try {
                skillName = `Skill Result ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    command.message(`${fakeStatus} S_EACH_SKILL_RESULT: ${skillName} (ID: ${skillId}) from ${event.source} to ${event.target}`);
                } catch (e) {
                    mod.error(`Failed to log skill result to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_EACH_SKILL_RESULT | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName} | Source: ${event.source} | Target: ${event.target}\n`);
            }
        }
        return true;
    });
    
    // S_ACTION_END - Server reporting skill action end
    registerHookedPacket('S_ACTION_END');
    mod.hook('S_ACTION_END', 5, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_ACTION_END packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Action End";
            try {
                skillName = `Action End ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    command.message(`${fakeStatus} S_ACTION_END: ${skillName} (ID: ${skillId}) by ${event.gameId}`);
                } catch (e) {
                    mod.error(`Failed to log action end to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_ACTION_END | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName} | GameId: ${event.gameId}\n`);
            }
        }
        return true;
    });
    
    // S_ACTION_STAGE - Server reporting skill action stage
    registerHookedPacket('S_ACTION_STAGE');
    mod.hook('S_ACTION_STAGE', 9, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_ACTION_STAGE packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Action Stage";
            try {
                skillName = `Action Stage ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    command.message(`${fakeStatus} S_ACTION_STAGE: ${skillName} (ID: ${skillId}) by ${event.gameId} stage ${event.stage}`);
                } catch (e) {
                    mod.error(`Failed to log action stage to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_ACTION_STAGE | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName} | GameId: ${event.gameId} | Stage: ${event.stage}\n`);
            }
        }
        return true;
    });
    
    // S_START_COOLTIME_SKILL - Server reporting skill cooldown start
    registerHookedPacket('S_START_COOLTIME_SKILL');
    mod.hook('S_START_COOLTIME_SKILL', 3, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_START_COOLTIME_SKILL packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logItemSkillToGame || mod.settings.logItemSkillToFile) {
            // Parse skill ID to get base skill
            const skillId = event.skill.id;
            const skillBaseId = Math.floor((skillId - 0x4000000) / 10000);
            
            // Get skill name if possible
            let skillName = "Unknown Skill Cooldown";
            try {
                skillName = `Skill Cooldown ${skillBaseId}`;
            } catch (e) {
                mod.warn(`Failed to get skill name for ID ${skillId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logItemSkillToGame) {
                try {
                    command.message(`${fakeStatus} S_START_COOLTIME_SKILL: ${skillName} (ID: ${skillId}) cooldown: ${event.cooldown}ms`);
                } catch (e) {
                    mod.error(`Failed to log skill cooldown to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logItemSkillToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_START_COOLTIME_SKILL | ID: ${skillId} | Base ID: ${skillBaseId} | Name: ${skillName} | Cooldown: ${event.cooldown}ms\n`);
            }
        }
        return true;
    });
    
    // --- Additional Equipment-related Packet Hooks ---
    
    // S_OBTAIN_TOKEN_ITEM - Server reporting token item obtained
    try {
        registerHookedPacket('S_OBTAIN_TOKEN_ITEM');
        mod.hook('S_OBTAIN_TOKEN_ITEM', mod.dispatch.protocolVersion.S_OBTAIN_TOKEN_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_OBTAIN_TOKEN_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Token Item";
                try {
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.itemId);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_OBTAIN_TOKEN_ITEM: ${itemName} (ID: ${event.itemId}) amount: ${event.amount}`);
                    } catch (e) {
                        mod.error(`Failed to log token item to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_OBTAIN_TOKEN_ITEM | ID: ${event.itemId} | Name: ${itemName} | Amount: ${event.amount}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_OBTAIN_TOKEN_ITEM: ${e.message}`);
    }
    
    // S_PREVIEW_ITEM - Server sending item preview
    registerHookedPacket('S_PREVIEW_ITEM');
    mod.hook('S_PREVIEW_ITEM', 1, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_PREVIEW_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
            // Log to game chat
            if (mod.settings.logEquipmentToGame) {
                try {
                    command.message(`${fakeStatus} S_PREVIEW_ITEM: Preview item data received`);
                } catch (e) {
                    mod.error(`Failed to log item preview to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_PREVIEW_ITEM | Preview data received\n`);
            }
        }
        return true;
    });
    
    // S_RECEIVE_TOKEN_TARGET_ITEM - Server reporting token target item received
    try {
        registerHookedPacket('S_RECEIVE_TOKEN_TARGET_ITEM');
        mod.hook('S_RECEIVE_TOKEN_TARGET_ITEM', mod.dispatch.protocolVersion.S_RECEIVE_TOKEN_TARGET_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_RECEIVE_TOKEN_TARGET_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Token Target Item";
                try {
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.itemId);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_RECEIVE_TOKEN_TARGET_ITEM: ${itemName} (ID: ${event.itemId})`);
                    } catch (e) {
                        mod.error(`Failed to log token target item to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_RECEIVE_TOKEN_TARGET_ITEM | ID: ${event.itemId} | Name: ${itemName}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_RECEIVE_TOKEN_TARGET_ITEM: ${e.message}`);
    }
    
    // S_RESULT_COMBINE_ITEM - Server reporting item combination result
    try {
        registerHookedPacket('S_RESULT_COMBINE_ITEM');
        mod.hook('S_RESULT_COMBINE_ITEM', mod.dispatch.protocolVersion.S_RESULT_COMBINE_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_RESULT_COMBINE_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_RESULT_COMBINE_ITEM: Item combination result: ${event.success ? 'Success' : 'Failed'}`);
                    } catch (e) {
                        mod.error(`Failed to log item combination result to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_RESULT_COMBINE_ITEM | Success: ${event.success}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_RESULT_COMBINE_ITEM: ${e.message}`);
    }
    
    // S_RESULT_REPAIR_ITEM - Server reporting item repair result
    try {
        registerHookedPacket('S_RESULT_REPAIR_ITEM');
        mod.hook('S_RESULT_REPAIR_ITEM', mod.dispatch.protocolVersion.S_RESULT_REPAIR_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_RESULT_REPAIR_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_RESULT_REPAIR_ITEM: Item repair result received`);
                    } catch (e) {
                        mod.error(`Failed to log item repair result to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_RESULT_REPAIR_ITEM | Repair result received\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_RESULT_REPAIR_ITEM: ${e.message}`);
    }
    
    // S_SEND_QUEST_ITEM_INFO - Server sending quest item info
    try {
        registerHookedPacket('S_SEND_QUEST_ITEM_INFO');
        mod.hook('S_SEND_QUEST_ITEM_INFO', mod.dispatch.protocolVersion.S_SEND_QUEST_ITEM_INFO || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_SEND_QUEST_ITEM_INFO packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_SEND_QUEST_ITEM_INFO: Quest item info received`);
                    } catch (e) {
                        mod.error(`Failed to log quest item info to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_SEND_QUEST_ITEM_INFO | Quest item info received\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_SEND_QUEST_ITEM_INFO: ${e.message}`);
    }
    
    // S_SET_SEND_PARCEL_ITEM - Server setting parcel item
    try {
        registerHookedPacket('S_SET_SEND_PARCEL_ITEM');
        mod.hook('S_SET_SEND_PARCEL_ITEM', mod.dispatch.protocolVersion.S_SET_SEND_PARCEL_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_SET_SEND_PARCEL_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_SET_SEND_PARCEL_ITEM: Parcel item set`);
                    } catch (e) {
                        mod.error(`Failed to log parcel item to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_SET_SEND_PARCEL_ITEM | Parcel item set\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_SET_SEND_PARCEL_ITEM: ${e.message}`);
    }
    
    // S_SHOW_TRADE_ITEM - Server showing trade item
    try {
        registerHookedPacket('S_SHOW_TRADE_ITEM');
        mod.hook('S_SHOW_TRADE_ITEM', mod.dispatch.protocolVersion.S_SHOW_TRADE_ITEM || 1, { order: 1000, filter: { fake: null } }, event => {
            const fakeStatus = event.fake ? 'FAKE' : 'REAL';
            debugLog(`Received ${fakeStatus} S_SHOW_TRADE_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
            
            if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
                // Get item name if possible
                let itemName = "Unknown Trade Item";
                try {
                    if (mod.game.data && mod.game.data.items) {
                        const item = mod.game.data.items.get(event.itemId);
                        if (item && item.name) {
                            itemName = item.name;
                        }
                    }
                } catch (e) {
                    mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
                }

                // Log to game chat
                if (mod.settings.logEquipmentToGame) {
                    try {
                        command.message(`${fakeStatus} S_SHOW_TRADE_ITEM: ${itemName} (ID: ${event.itemId})`);
                    } catch (e) {
                        mod.error(`Failed to log trade item to chat: ${e.message}`);
                    }
                }
                
                // Log to file
                if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                    const timestamp = new Date().toISOString();
                    itemSkillLogStream.write(`${timestamp} | S_SHOW_TRADE_ITEM | ID: ${event.itemId} | Name: ${itemName}\n`);
                }
            }
            return true;
        });
    } catch (e) {
        mod.warn(`Could not hook S_SHOW_TRADE_ITEM: ${e.message}`);
    }
    
    // S_USE_RIGHT_ITEM - Server using right item
    registerHookedPacket('S_USE_RIGHT_ITEM');
    mod.hook('S_USE_RIGHT_ITEM', 1, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_USE_RIGHT_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
            // Log to game chat
            if (mod.settings.logEquipmentToGame) {
                try {
                    command.message(`${fakeStatus} S_USE_RIGHT_ITEM: User ${event.gameId} used right item`);
                } catch (e) {
                    mod.error(`Failed to log right item use to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_USE_RIGHT_ITEM | GameId: ${event.gameId}\n`);
            }
        }
        return true;
    });
    
    // S_START_COOLTIME_ITEM - Server reporting item cooldown start
    registerHookedPacket('S_START_COOLTIME_ITEM');
    mod.hook('S_START_COOLTIME_ITEM', 1, { order: 1000, filter: { fake: null } }, event => {
        const fakeStatus = event.fake ? 'FAKE' : 'REAL';
        debugLog(`Received ${fakeStatus} S_START_COOLTIME_ITEM packet: ${JSON.stringify(event, bigIntReplacer)}`);
        
        if (mod.settings.logEquipmentToGame || mod.settings.logEquipmentToFile) {
            // Get item name if possible
            let itemName = "Unknown Item";
            try {
                if (mod.game.data && mod.game.data.items) {
                    const item = mod.game.data.items.get(event.itemId);
                    if (item && item.name) {
                        itemName = item.name;
                    }
                }
            } catch (e) {
                mod.warn(`Failed to get item name for ID ${event.itemId}: ${e.message}`);
            }

            // Log to game chat
            if (mod.settings.logEquipmentToGame) {
                try {
                    command.message(`${fakeStatus} S_START_COOLTIME_ITEM: ${itemName} (ID: ${event.itemId}) cooldown: ${event.cooldown}ms`);
                } catch (e) {
                    mod.error(`Failed to log item cooldown to chat: ${e.message}`);
                }
            }
            
            // Log to file
            if (mod.settings.logEquipmentToFile && itemSkillLogStream) {
                const timestamp = new Date().toISOString();
                itemSkillLogStream.write(`${timestamp} | S_START_COOLTIME_ITEM | ID: ${event.itemId} | Name: ${itemName} | Cooldown: ${event.cooldown}ms\n`);
            }
        }
        return true;
    });

    // --- Command Definition ---
    command.add('pktlog', (filterArg) => {
        if (filterArg && filterArg.trim().length > 0) {
            const newFilter = filterArg.trim().toUpperCase();
            
            // Check if this filter is already in the list
            const filterIndex = mod.settings.packetFilters.indexOf(newFilter);
            
            if (filterIndex === -1) {
                // Add new filter
                mod.settings.packetFilters.push(newFilter);
                command.message(`Added packet filter: ${newFilter}`);
            } else {
                // Remove existing filter
                mod.settings.packetFilters.splice(filterIndex, 1);
                command.message(`Removed packet filter: ${newFilter}`);
            }
            
            // Show current filters
            if (mod.settings.packetFilters.length > 0) {
                command.message(`Current packet filters: ${mod.settings.packetFilters.join(', ')}`);
            } else {
                command.message('All packet filters removed.');
            }
        } else {
            // Clear all filters
            mod.settings.packetFilters = [];
            command.message('All packet filters removed.');
        }
    });

    command.add('pktlogfake', () => {
        mod.settings.logFakePackets = !mod.settings.logFakePackets;
        command.message(`Logging of fake packets ${mod.settings.logFakePackets ? 'enabled' : 'disabled'}.`);
    });
    
    command.add('pktloggame', () => {
        mod.settings.logPktToGame = !mod.settings.logPktToGame;
        command.message(`Logging packets to in-game text ${mod.settings.logPktToGame ? 'enabled' : 'disabled'}.`);
    });
    
    command.add('pktlogfile', () => {
        mod.settings.logPktToFile = !mod.settings.logPktToFile;
        command.message(`Logging packets to file ${mod.settings.logPktToFile ? 'enabled' : 'disabled'}.`);
    });

    command.add('itemskillgame', () => {
        mod.settings.logItemSkillToGame = !mod.settings.logItemSkillToGame;
        command.message(`Logging item/skill to in-game text ${mod.settings.logItemSkillToGame ? 'enabled' : 'disabled'}.`);
    });
    
    command.add('itemskillfile', () => {
        mod.settings.logItemSkillToFile = !mod.settings.logItemSkillToFile;
        command.message(`Logging item/skill to file ${mod.settings.logItemSkillToFile ? 'enabled' : 'disabled'}.`);
    });
    
    command.add('pktdebug', () => {
        mod.settings.debug = !mod.settings.debug;
        command.message(`Debug logging ${mod.settings.debug ? 'enabled' : 'disabled'}.`);
    });
    
    command.add('equipgame', () => {
        mod.settings.logEquipmentToGame = !mod.settings.logEquipmentToGame;
        command.message(`Logging equipment to in-game text ${mod.settings.logEquipmentToGame ? 'enabled' : 'disabled'}.`);
    });
    
    command.add('equipfile', () => {
        mod.settings.logEquipmentToFile = !mod.settings.logEquipmentToFile;
        command.message(`Logging equipment to file ${mod.settings.logEquipmentToFile ? 'enabled' : 'disabled'}.`);
    });

    command.add('pkthookedonly', () => {
        mod.settings.logOnlyHookedPackets = !mod.settings.logOnlyHookedPackets;
        command.message(`Logging only hooked packets ${mod.settings.logOnlyHookedPackets ? 'enabled' : 'disabled'}.`);
    });

    // --- Cleanup ---
    this.destructor = () => {
        if (logStream) {
            logStream.end();
            mod.log('Packet log stream closed.');
        }
        if (itemSkillLogStream) {
            itemSkillLogStream.end();
            mod.log('Item/Skill log stream closed.');
        }
        command.remove('pktlog');
        command.remove('pktlogfake');
        command.remove('pktloggame');
        command.remove('pktlogfile');
        command.remove('itemskillgame');
        command.remove('itemskillfile');
        command.remove('equipgame');
        command.remove('equipfile');
        command.remove('pktdebug');
        command.remove('pkthookedonly');
    };
};