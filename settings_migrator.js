"use strict"

const DefaultSettings = {
    "packetFilters": [],         // Array of filters for packet names (case-insensitive)
    "logFakePackets": false,     // Whether to log packets sent by mods
    "logPktToGame": true,        // Whether to log packets to in-game text
    "logPktToFile": true,        // Whether to log packets to file
    "logItemSkillToGame": true,  // Whether to log item and skill usage to in-game text
    "logItemSkillToFile": true,  // Whether to log item and skill usage to file
    "logEquipmentToGame": true,  // Whether to log equipment-related packets to in-game text
    "logEquipmentToFile": true,  // Whether to log equipment-related packets to file
    "debug": false               // Whether to enable debug logging
}

module.exports = function MigrateSettings(from_ver, to_ver, settings) {
    if (from_ver === undefined) {
        // Migrate legacy config file
        return Object.assign(Object.assign({}, DefaultSettings), settings);
    } else if (from_ver === null) {
        // No config file exists, use default settings
        return DefaultSettings;
    } else {
        // Migrate from older version (using the new system) to latest one
        if (from_ver + 1 < to_ver) {
            // Recursively upgrade in one-version steps
            settings = MigrateSettings(from_ver, from_ver + 1, settings);
            return MigrateSettings(from_ver + 1, to_ver, settings);
        }

        // If we reach this point it's guaranteed that from_ver === to_ver - 1, so we can implement
        // a switch for each version step that upgrades to the next version. This enables us to
        // upgrade from any version to the latest version without additional effort!
        switch(to_ver)
        {
            case 2:
                // Migrate from v1 to v2
                settings.logPktToGame = settings.logToGame !== undefined ? settings.logToGame : DefaultSettings.logPktToGame;
                settings.logPktToFile = settings.logToFile !== undefined ? settings.logToFile : DefaultSettings.logPktToFile;
                settings.logItemSkillToGame = DefaultSettings.logItemSkillToGame;
                settings.logItemSkillToFile = DefaultSettings.logItemSkillToFile;
                
                // Remove old settings
                delete settings.logToGame;
                delete settings.logToFile;
                break;
                
            // keep old settings, add new ones
            default:
                let oldsettings = settings
                
                settings = Object.assign(DefaultSettings, {});
                
                for(let option in oldsettings) {
                    if(settings[option]) {
                        settings[option] = oldsettings[option]
                    }
                }

                if(from_ver < to_ver) console.log('[Packet-Logger] Your settings have been updated to version ' + to_ver + '. You can edit the new config file after the next relog.')
                break;
        }

        return settings;
    }
}