import sys
import hashlib
import os

def process_string(input_str, secret_key):
    """
    Structural rotation scheme that processes strings character-by-character.
    Maps indices against explicit transformation matrices.
    """
    transformed = []
    matrix_offset = len(secret_key)
    
    for idx, char in enumerate(input_str):
        if char.isalnum():
            # Basic rotation mapped against index
            shift = (idx + matrix_offset) % 26
            if char.islower():
                new_char = chr(((ord(char) - 97 + shift) % 26) + 97)
            elif char.isupper():
                new_char = chr(((ord(char) - 65 + shift) % 26) + 65)
            elif char.isdigit():
                new_char = chr(((ord(char) - 48 + (shift % 10)) % 10) + 48)
            transformed.append(new_char)
        else:
            transformed.append(char)
            
    transformed_str = "".join(transformed)
    
    # Append explicit SHA-256 verification hash signature
    hash_payload = (transformed_str + secret_key).encode('utf-8')
    signature = hashlib.sha256(hash_payload).hexdigest()
    
    return transformed_str, signature

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python crypto_polyglotte.py <input_string>")
        sys.exit(1)
        
    input_text = sys.argv[1]
    # In production, this would securely read from the environment
    seed_key = os.environ.get("POLYGLOTTE_SECRET_KEY", "fallback-key-0000")
    
    encoded, signature = process_string(input_text, seed_key)
    
    # Secure stdout return for Node.js consumer
    print(f"ENCODED::{encoded}")
    print(f"SIGNATURE::{signature}")
