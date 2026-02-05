"""
Script to fix the model compatibility issue by loading and resaving it.
This fixes the BatchNormalization axis issue.
"""

import os
import h5py
import tensorflow as tf
import numpy as np

def fix_batch_norm_in_h5(h5_file_path):
    """Fix BatchNormalization axis in the H5 file directly"""
    print(f"Opening H5 file: {h5_file_path}")
    
    with h5py.File(h5_file_path, 'r+') as f:
        # Check if model_config exists
        if 'model_config' in f.attrs:
            import json
            
            # Load the config
            config_str = f.attrs['model_config']
            if isinstance(config_str, bytes):
                config_str = config_str.decode('utf-8')
            
            config = json.loads(config_str)
            print("Found model config")
            
            # Function to recursively fix axis in config
            def fix_axis_recursive(obj):
                if isinstance(obj, dict):
                    # Fix axis if it's a BatchNormalization layer
                    if obj.get('class_name') == 'BatchNormalization':
                        if 'config' in obj and 'axis' in obj['config']:
                            if isinstance(obj['config']['axis'], list):
                                old_axis = obj['config']['axis']
                                obj['config']['axis'] = old_axis[0] if len(old_axis) > 0 else -1
                                print(f"Fixed BatchNormalization axis: {old_axis} -> {obj['config']['axis']}")
                    
                    # Remove time_major from LSTM layers (deprecated in Keras 3.x)
                    if obj.get('class_name') == 'LSTM':
                        if 'config' in obj and 'time_major' in obj['config']:
                            del obj['config']['time_major']
                            print(f"Removed time_major from LSTM layer: {obj['config'].get('name', 'unnamed')}")
                    
                    # Recursively process all dict values
                    for key, value in obj.items():
                        obj[key] = fix_axis_recursive(value)
                
                elif isinstance(obj, list):
                    # Recursively process all list items
                    return [fix_axis_recursive(item) for item in obj]
                
                return obj
            
            # Fix the config
            config = fix_axis_recursive(config)
            
            # Save the fixed config back
            config_str = json.dumps(config)
            del f.attrs['model_config']
            f.attrs['model_config'] = config_str
            print("✓ Fixed and saved model config")
            
    print("✓ H5 file updated successfully")

def main():
    model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 
                             "saved_models", "1", "model.h5")
    
    print("="*60)
    print("Model Compatibility Fix Script")
    print("="*60)
    
    if not os.path.exists(model_path):
        print(f"ERROR: Model file not found at {model_path}")
        return
    
    # Create backup
    backup_path = model_path + ".backup"
    if not os.path.exists(backup_path):
        print(f"\nCreating backup at: {backup_path}")
        import shutil
        shutil.copy2(model_path, backup_path)
        print("✓ Backup created")
    else:
        print(f"\nBackup already exists at: {backup_path}")
    
    # Fix the H5 file
    print("\nFixing BatchNormalization axis in H5 file...")
    fix_batch_norm_in_h5(model_path)
    
    # Try to load the fixed model
    print("\nTesting model loading...")
    try:
        model = tf.keras.models.load_model(model_path, compile=False)
        print("✓ Model loaded successfully!")
        print(f"\nModel summary:")
        model.summary()
        print("\n" + "="*60)
        print("SUCCESS! Model is now compatible.")
        print("="*60)
    except Exception as e:
        print(f"\n✗ Model still has issues: {str(e)}")
        print("\nRestoring from backup...")
        import shutil
        shutil.copy2(backup_path, model_path)
        print("Backup restored. You may need to retrain the model.")
        raise

if __name__ == "__main__":
    main()
