// webhook-handler.js - Server-side handler for CRM form submissions
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve the HTML interface

// Store app configurations (in production, use a database)
const appConfigurations = new Map();

// Webhook endpoint for form submissions
app.post('/webhook/form-submission', async (req, res) => {
    try {
        console.log('📨 Form submission received:', req.body);
        
        // Extract form data from CRM webhook
        const {
            locationId,
            formId,
            contactId,
            submissionData,
            type
        } = req.body;

        // Get app configuration for this location
        const config = appConfigurations.get(locationId);
        if (!config) {
            console.log('❌ No configuration found for location:', locationId);
            return res.status(400).json({ error: 'App not configured for this location' });
        }

        // Check if this form is configured for object creation
        if (config.formId !== formId) {
            console.log('ℹ️ Form not configured for object creation:', formId);
            return res.status(200).json({ message: 'Form not configured for processing' });
        }

        // Process the form submission
        const result = await processFormSubmission(submissionData, config);
        
        if (result.success) {
            console.log('✅ Successfully created custom object:', result.objectId);
            res.status(200).json({ 
                success: true, 
                objectId: result.objectId,
                uniqueKey: result.uniqueKey
            });
        } else {
            console.log('❌ Failed to create custom object:', result.error);
            res.status(500).json({ error: result.error });
        }

    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process form submission and create custom object
async function processFormSubmission(formData, config) {
    try {
        console.log('🔄 Processing form data:', formData);
        
        // Generate unique key
        const uniqueKey = generateUniqueKey(formData, config.keyType, config.keyConfig);
        console.log('🔑 Generated unique key:', uniqueKey);
        
        // Map form fields to object fields
        const objectData = mapFormToObject(formData, config.fieldMappings);
        objectData.uniqueKey = uniqueKey;
        
        console.log('📋 Mapped object data:', objectData);
        
        // Create custom object via CRM API
        const objectResult = await createCustomObject(objectData, config);
        
        return {
            success: true,
            objectId: objectResult.id,
            uniqueKey: uniqueKey
        };
        
    } catch (error) {
        console.error('❌ Error processing form submission:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Generate unique key based on configuration
function generateUniqueKey(formData, keyType, keyConfig) {
    const timestamp = new Date();
    
    switch (keyType) {
        case 'uuid':
            return generateUUID(keyConfig);
            
        case 'sequential':
            return generateSequentialKey(keyConfig);
            
        case 'date':
            return generateDateKey(timestamp, keyConfig);
            
        case 'composite':
            return generateCompositeKey(formData, keyConfig);
            
        default:
            return 'obj_' + Math.random().toString(36).substr(2, 9);
    }
}

// UUID generation
function generateUUID(config = {}) {
    const format = config.format || 'standard';
    
    switch (format) {
        case 'short':
            return Math.random().toString(36).substr(2, 15) + Math.random().toString(36).substr(2, 7);
        case 'numeric':
            return Date.now().toString() + Math.floor(Math.random() * 1000);
        default:
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
    }
}

// Sequential key generation
function generateSequentialKey(config = {}) {
    const prefix = config.prefix || 'OBJ';
    const startingNumber = config.startingNumber || 1;
    const padding = config.padding || 3;
    
    // In production, you'd get the next number from database
    const nextNumber = startingNumber + Math.floor(Math.random() * 1000);
    
    return prefix + '-' + String(nextNumber).padStart(padding, '0');
}

// Date-based key generation
function generateDateKey(timestamp, config = {}) {
    const format = config.format || 'YYYYMMDD-HHMMSS';
    const timezone = config.timezone || 'UTC';
    
    // Convert to specified timezone
    const date = new Date(timestamp.toLocaleString("en-US", {timeZone: timezone}));
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    
    switch (format) {
        case 'YYYY-MM-DD-HH-MM-SS':
            return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
        case 'YYYYMMDD':
            return `${year}${month}${day}`;
        case 'YYMMDD-HHMM':
            return `${String(year).substr(2)}${month}${day}-${hour}${minute}`;
        default:
            return `${year}${month}${day}-${hour}${minute}${second}`;
    }
}

// Composite key generation
function generateCompositeKey(formData, config = {}) {
    const pattern = config.pattern || '{lastName}-{firstName}-{year}';
    const separator = config.separator || '-';
    const caseConversion = config.caseConversion || 'UPPERCASE';
    
    let key = pattern;
    
    // Replace placeholders with form data
    Object.keys(formData).forEach(field => {
        const placeholder = `{${field}}`;
        if (key.includes(placeholder)) {
            key = key.replace(placeholder, formData[field] || 'UNKNOWN');
        }
    });
    
    // Add current year if {year} placeholder
    key = key.replace('{year}', new Date().getFullYear());
    
    // Apply case conversion
    switch (caseConversion) {
        case 'UPPERCASE':
            key = key.toUpperCase();
            break;
        case 'lowercase':
            key = key.toLowerCase();
            break;
        // 'No Change' - do nothing
    }
    
    return key;
}

// Map form data to object fields
function mapFormToObject(formData, fieldMappings) {
    const objectData = {};
    
    fieldMappings.forEach(mapping => {
        if (formData[mapping.formField] && mapping.objectField) {
            objectData[mapping.objectField] = formData[mapping.formField];
        }
    });
    
    // Add metadata
    objectData.createdAt = new Date().toISOString();
    objectData.source = 'form_submission';
    
    return objectData;
}

// Create custom object via CRM API
async function createCustomObject(objectData, config) {
    try {
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
                }
            }
        );
        
        console.log('✅ Custom object created:', response.data);
        return response.data;
        
    } catch (error) {
        console.error('❌ Error creating custom object:', error.response?.data || error.message);
        throw new Error(`Failed to create custom object: ${error.response?.data?.message || error.message}`);
    }
}

// Configuration endpoints for the app interface
app.post('/api/configure', (req, res) => {
    try {
        const {
            locationId,
            apiKey,
            formId,
            objectType,
            fieldMappings,
            keyType,
            keyConfig
        } = req.body;
        
        // Store configuration (in production, save to database)
        appConfigurations.set(locationId, {
            locationId,
            apiKey,
            formId,
            objectType,
            fieldMappings,
            keyType,
            keyConfig,
            updatedAt: new Date().toISOString()
        });
        
        console.log('⚙️ Configuration saved for location:', locationId);
        res.json({ success: true, message: 'Configuration saved successfully' });
        
    } catch (error) {
        console.error('❌ Error saving configuration:', error);
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

app.get('/api/configure/:locationId', (req, res) => {
    const config = appConfigurations.get(req.params.locationId);
    if (config) {
        // Don't return the API key for security
        const { apiKey, ...safeConfig } = config;
        res.json(safeConfig);
    } else {
        res.status(404).json({ error: 'Configuration not found' });
    }
});

// Test endpoint
app.post('/api/test-submission', async (req, res) => {
    try {
        const testData = {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            phone: '555-0123',
            company: 'Test Company'
        };
        
        const config = appConfigurations.get(req.body.locationId);
        if (!config) {
            return res.status(400).json({ error: 'No configuration found' });
        }
        
        const result = await processFormSubmission(testData, config);
        res.json(result);
        
    } catch (error) {
        console.error('❌ Test submission error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get CRM forms for a location
app.get('/api/forms/:locationId', async (req, res) => {
    try {
        const { locationId } = req.params;
        const { apiKey } = req.query;
        
        const response = await axios.get(
            `https://services.leadconnectorhq.com/locations/${locationId}/forms`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Version': '2021-07-28'
                }
            }
        );
        
        res.json(response.data);
        
    } catch (error) {
        console.error('❌ Error fetching forms:', error);
        res.status(500).json({ error: 'Failed to fetch forms' });
    }
});

// Get CRM custom objects for a location
app.get('/api/objects/:locationId', async (req, res) => {
    try {
        const { locationId } = req.params;
        const { apiKey } = req.query;
        
        const response = await axios.get(
            `https://services.leadconnectorhq.com/locations/${locationId}/customObjects/schemas`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Version': '2021-07-28'
                }
            }
        );
        
        res.json(response.data);
        
    } catch (error) {
        console.error('❌ Error fetching custom objects:', error);
        res.status(500).json({ error: 'Failed to fetch custom objects' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeConfigurations: appConfigurations.size
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Form to Object Creator app running on port ${PORT}`);
    console.log(`📋 Webhook endpoint: http://localhost:${PORT}/webhook/form-submission`);
    console.log(`⚙️ Configuration API: http://localhost:${PORT}/api/configure`);
});

module.exports = app;
