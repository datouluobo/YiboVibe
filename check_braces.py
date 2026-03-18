
def check_all_delimiters_robust(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    stack = []
    pairs = {')': '(', '}': '{', ']': '['}
    in_string = False
    in_char = False
    escaped = False
    
    for i, char in enumerate(content):
        if escaped:
            escaped = False; continue
        if char == '\\':
            escaped = True; continue
        if char == '"' and not in_char:
            in_string = not in_string; continue
        if char == "'" and not in_string:
            in_char = not in_char; continue
        if in_string or in_char:
            continue
            
        if char in '({[':
            stack.append((char, i))
        elif char in ')}]':
            if not stack:
                prefix = content[:i]
                line = prefix.count('\n') + 1
                col = i - prefix.rfind('\n')
                print(f"FAILED: Unexpected '{char}' at line {line}, col {col}")
                return
            last_char, _ = stack.pop()
            if last_char != pairs[char]:
                prefix = content[:i]
                line = prefix.count('\n') + 1
                col = i - prefix.rfind('\n')
                print(f"FAILED: Mismatch! Found '{char}' at line {line}, col {col}, but last open was '{last_char}'")
                return
    
    if stack:
        print(f"FAILED: {len(stack)} unclosed delimiters remaining:")
        for char, pos in stack:
            prefix = content[:pos]
            line = prefix.count('\n') + 1
            col = pos - prefix.rfind('\n')
            print(f"  - '{char}' at line {line}, col {col}")
    else:
        print("SUCCESS: All delimiters are perfectly balanced.")

if __name__ == "__main__":
    import os
    target = os.path.join(os.getcwd(), "core", "src", "hook_manager.rs")
    check_all_delimiters_robust(target)
