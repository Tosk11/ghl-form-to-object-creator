// webhook-handler.js - Clean CRM Form-to-Object Webhook Automation
const express = require('express');
const axios = require('axios');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store configurations (in production, use a database)
const configurations = new Map();

// Activity logs for monitoring
const activityLogs = [];

// Add log entry
function addLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, message, type };
    activityLogs.push(logEntry);
    
    // Keep only last 100 logs
    if (activityLogs.length > 100) {
        activityLogs.shift();
    }
    
    // Console log with emojis for Railway logs
    const emoji = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} ${message}`);
}

// Generate unique keys
function generateUniqueKey(formData, keyType = 'uuid', keyConfig = {}) {
    const timestamp = new Date();
    
    switch (keyType) {
        case 'uuid':
            return 'obj_' + Math.random().toString(36).substr(2, 12);
            
        case 'sequential':
            const prefix = keyConfig.prefix || 'ITEM';
            const counter = configurations.size + Math.floor(Math.random() * 1000) + 1;
            return `${prefix}-${String(counter).padStart(3, '0')}`;
            
        case 'date':
            const year = timestamp.getFullYear();
            const month = String(timestamp.getMonth() + 1).padStart(2, '0');
            const day = String(timestamp.getDate()).padStart(2, '0');
            const hour = String(timestamp.getHours()).padStart(2, '0');
            const minute = String(timestamp.getMinutes()).padStart(2, '0');
            const second = String(timestamp.getSeconds()).padStart(2, '0');
            return `${year}${month}${day}-${hour}${minute}${second}`;
            
        case 'composite':
            const lastName = formData.lastName || formData.last_name || 'UNKNOWN';
            const firstName = formData.firstName || formData.first_name || 'UNKNOWN';
            const year = timestamp.getFullYear();
            return `${lastName}-${firstName}-${year}`.toUpperCase();
            
        default:
            return 'key_' + Date.now();
    }
}

// Map form data to object fields
function mapFormToObject(formData, fieldMappings) {
    const objectData = {};
    
    // Apply configured field mappings
    fieldMappings.forEach(mapping => {
        if (formData[mapping.formField] && mapping.objectField) {
            objectData[mapping.objectField] = formData[mapping.formField];
        }
    });
    
    // Add metadata
    objectData.createdAt = new Date().toISOString();
    objectData.source = 'webhook_automation';
    
    return objectData;
}

// Create custom object via CRM API
async function createCustomObject(objectData, config) {
    try {
        addLog(`Creating ${config.objectType} object...`, 'info');
        
        const response = await axios.post(
            `https://services.leadconnectorhq.com/locations/${config.locationId}/customObjects`,
            {
                objectType: config.objectType,
                data: objectData
            },
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                },
                timeout: 10000
            }
        );
        
        addLog(`Custom object created successfully: ${response.data.id}`, 'success');
        return { success: true, data: response.data };
        
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        addLog(`Failed to create custom object: ${errorMsg}`, 'error');
        throw new Error(`Failed to create custom object: ${errorMsg}`);
    }
}

// MAIN WEBHOOK ENDPOINT - Receives form submissions from CRM
app.post('/webhook/form-submission', async (req, res) => {
    try {
        addLog('📨 Webhook received form submission', 'info');
        console.log('Raw webhook data:', JSON.stringify(req.body, null, 2));
        
        // Extract data from webhook payload
        const formData = req.body.data || req.body;
        const locationId = req.body.extras?.locationId || req.body.locationId;
        const formId = req.body.extras?.formId || req.body.formId;
        
        addLog(`Form ID: ${formId}, Location: ${locationId}`, 'info');
        
        // Find configuration for this location and form
        const configKey = `${locationId}_${formId}`;
        const config = configurations.get(configKey);
        
        if (!config) {
            addLog(`No configuration found for ${configKey}`, 'warning');
            return res.status(200).json({ 
                success: false, 
                message: 'No configuration found for this form' 
            });
        }
        
        // Generate unique key
        const uniqueKey = generateUniqueKey(formData, config.keyType, config.keyConfig);
        addLog(`Generated unique key: ${uniqueKey}`, 'info');
        
        // Map form fields to object fields
        const objectData = mapFormToObject(formData, config.fieldMappings);
        objectData.uniqueKey = uniqueKey;
        
        addLog(`Mapped object data: ${JSON.stringify(objectData)}`, 'info');
        
        // Create custom object
        const result = await createCustomObject(objectData, config);
        
        addLog('🎉 Webhook processing completed successfully', 'success');
        
        res.status(200).json({
            success: true,
            objectId: result.data.id,
            uniqueKey: uniqueKey,
            message: 'Object created successfully'
        });
        
    } catch (error) {
        addLog(`Webhook error: ${error.message}`, 'error');
        console.error('Webhook processing error:', error);
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Save configuration
app.post('/api/configure', (req, res) => {
    try {
        const { locationId, apiKey, formId, objectType, fieldMappings, keyType, keyConfig } = req.body;
        
        if (!locationId || !apiKey || !formId || !objectType) {
            return res.status(400).json({ error: 'Missing required configuration fields' });
        }
        
        const configKey = `${locationId}_${formId}`;
        const configuration = {
            locationId,
            apiKey,
            formId,
            objectType,
            fieldMappings: fieldMappings || [],
            keyType: keyType || 'uuid',
            keyConfig: keyConfig || {},
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        configurations.set(configKey, configuration);
        
        addLog(`Configuration saved for form ${formId} in location ${locationId}`, 'success');
        addLog(`Object type: ${objectType}, Key type: ${keyType}`, 'info');
        addLog(`Field mappings: ${fieldMappings.length} mappings configured`, 'info');
        
        res.json({ 
            success: true, 
            message: 'Configuration saved successfully',
            configKey: configKey
        });
        
    } catch (error) {
        addLog(`Configuration error: ${error.message}`, 'error');
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Get configuration
app.get('/api/configure/:locationId/:formId', (req, res) => {
    const configKey = `${req.params.locationId}_${req.params.formId}`;
    const config = configurations.get(configKey);
    
    if (config) {
        // Don't return the API key for security
        const { apiKey, ...safeConfig } = config;
        res.json(safeConfig);
    } else {
        res.status(404).json({ error: 'Configuration not found' });
    }
});

// Test webhook processing with sample data
app.post('/api/test-submission', async (req, res) => {
    try {
        const { locationId } = req.body;
        
        if (!locationId) {
            return res.status(400).json({ error: 'Location ID required for testing' });
        }
        
        // Find any configuration for this location
        let testConfig = null;
        for (const [key, config] of configurations) {
            if (config.locationId === locationId) {
                testConfig = config;
                break;
            }
        }
        
        if (!testConfig) {
            return res.status(400).json({ error: 'No configuration found for this location' });
        }
        
        addLog('🧪 Testing webhook with sample data', 'info');
        
        // Sample test data
        const testData = {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            phone: '555-0123',
            company: 'Test Company',
            message: 'This is a test submission'
        };
        
        // Generate unique key
        const uniqueKey = generateUniqueKey(testData, testConfig.keyType, testConfig.keyConfig);
        
        // Map form fields to object fields
        const objectData = mapFormToObject(testData, testConfig.fieldMappings);
        objectData.uniqueKey = uniqueKey;
        
        // Create custom object
        const result = await createCustomObject(objectData, testConfig);
        
        addLog('✅ Test completed successfully', 'success');
        
        res.json({
            success: true,
            message: 'Test webhook completed successfully',
            objectId: result.data.id,
            uniqueKey: uniqueKey,
            testData: objectData
        });
        
    } catch (error) {
        addLog(`Test error: ${error.message}`, 'error');
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Get activity logs
app.get('/api/logs', (req, res) => {
    res.json({ 
        logs: activityLogs.slice(-50), // Return last 50 logs
        totalLogs: activityLogs.length 
    });
});

// Clear activity logs
app.delete('/api/logs', (req, res) => {
    activityLogs.length = 0;
    addLog('Logs cleared', 'info');
    res.json({ success: true, message: 'Logs cleared' });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeConfigurations: configurations.size,
        totalLogs: activityLogs.length,
        uptime: process.uptime()
    });
});

// Get app statistics
app.get('/api/stats', (req, res) => {
    const successLogs = activityLogs.filter(log => log.type === 'success').length;
    const errorLogs = activityLogs.filter(log => log.type === 'error').length;
    const totalProcessed = successLogs + errorLogs;
    const successRate = totalProcessed > 0 ? Math.round((successLogs / totalProcessed) * 100) : 100;
    
    res.json({
        activeConfigurations: configurations.size,
        totalProcessed: totalProcessed,
        successfulSubmissions: successLogs,
        successRate: successRate,
        lastActivity: activityLogs.length > 0 ? activityLogs[activityLogs.length - 1].timestamp : null
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    addLog(`🚀 CRM Form-to-Object Automation server running on port ${PORT}`, 'success');
    addLog(`📋 Webhook endpoint: /webhook/form-submission`, 'info');
    addLog(`⚙️ Configuration API: /api/configure`, 'info');
    addLog(`💚 Health check: /health`, 'info');
    console.log(`\n🎯 WEBHOOK URL FOR CRM:\nhttps://your-railway-domain.up.railway.app/webhook/form-submission\n`);
});

module.exports = app;
