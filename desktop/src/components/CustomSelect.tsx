import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
    val: any;
    label: string;
}

interface CustomSelectProps {
    options: Option[];
    value: any;
    onChange: (val: any) => void;
    placeholder?: string;
    style?: React.CSSProperties;
    triggerStyle?: React.CSSProperties;
    maxWidth?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({ options, value, onChange, placeholder, style, triggerStyle, maxWidth }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedOption = options.find(o => o.val === value);

    const updatePosition = () => {
        if (containerRef.current) {
            setRect(containerRef.current.getBoundingClientRect());
        }
    };

    useEffect(() => {
        if (isOpen) {
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
        } else {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        }
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                // Determine if click was inside the portal dropdown
                const target = event.target as HTMLElement;
                if (!target.closest('.custom-select-portal-dropdown')) {
                    setIsOpen(false);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const dropdownContent = isOpen && rect && (
        <div
            className="custom-select-portal-dropdown"
            style={{
                position: 'fixed',
                top: rect.bottom + 8,
                left: rect.left,
                width: rect.width,
                background: 'var(--color-glass-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--color-glass-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                zIndex: 99999,
                maxHeight: '300px',
                overflowY: 'auto',
                animation: 'fadeInUp 0.2s ease-out'
            }}
        >
            {options.map((option) => (
                <div
                    key={option.val}
                    onClick={(e) => {
                        e.stopPropagation();
                        onChange(option.val);
                        setIsOpen(false);
                    }}
                    className="custom-select-option"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 16px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        fontSize: '14px',
                        color: option.val === value ? 'var(--color-primary)' : 'var(--color-text-main)',
                        background: option.val === value ? 'var(--color-primary-glow)' : 'transparent',
                        fontWeight: option.val === value ? 600 : 400
                    }}
                    onMouseEnter={(e) => {
                        if (option.val !== value) {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (option.val !== value) {
                            e.currentTarget.style.background = 'transparent';
                        }
                    }}
                >
                    {option.label}
                    {option.val === value && <Check size={14} />}
                </div>
            ))}
            <style>{`
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .custom-select-portal-dropdown::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-select-portal-dropdown::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-select-portal-dropdown::-webkit-scrollbar-thumb {
                    background: var(--color-border);
                    border-radius: 10px;
                }
                .custom-select-portal-dropdown::-webkit-scrollbar-thumb:hover {
                    background: var(--color-text-muted);
                }
            `}</style>
        </div>
    );

    return (
        <div
            ref={containerRef}
            className="custom-select-container"
            style={{
                position: 'relative',
                width: maxWidth || '100%',
                ...style
            }}
        >
            <div
                className="custom-select-trigger"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'var(--color-surface-elevated)',
                    border: isOpen ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    color: selectedOption ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                    fontSize: '14px',
                    fontWeight: 500,
                    boxShadow: isOpen ? '0 0 0 2px var(--color-primary-glow)' : 'none',
                    ...triggerStyle
                }}
            >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedOption ? selectedOption.label : (placeholder || 'Select...')}
                </div>
                <ChevronDown
                    size={16}
                    style={{
                        marginLeft: '8px',
                        transition: 'transform 0.2s',
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0)'
                    }}
                />
            </div>

            {isOpen && createPortal(dropdownContent, document.body)}
        </div>
    );
};
