import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './SignUp.css';
import logo from '../assets/logo-white.png';
import signupBg from '../assets/signinup-image.jpg';
import googleLogo from '../assets/credentials-logo/google.png';
import appleLogo from '../assets/credentials-logo/apple.png';

function SignUp() {
  const navigate = useNavigate();
  const { signup, signInWithGoogle, signInWithApple } = useAuth();
  
  const [showLogo, setShowLogo] = useState(false);
  const [showText, setShowText] = useState(false);
  const [moveToPosition, setMoveToPosition] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const logoTimer = setTimeout(() => {
      setShowLogo(true);
    }, 50);

    const textTimer = setTimeout(() => {
      setShowText(true);
    }, 200);

    const moveTimer = setTimeout(() => {
      setMoveToPosition(true);
    }, 600);

    const cardTimer = setTimeout(() => {
      setShowCard(true);
    }, 800);

    return () => {
      clearTimeout(logoTimer);
      clearTimeout(textTimer);
      clearTimeout(moveTimer);
      clearTimeout(cardTimer);
    };
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!formData.email.trim()) {
      setError('Please enter your email');
      return;
    }
    if (!formData.password) {
      setError('Please enter your password');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await signup(formData.email, formData.password, formData.name);
      navigate('/');
    } catch (error) {
      setError('Failed to create account: ' + error.message);
    }
    setLoading(false);
  };

  const handleGoogleSignUp = async () => {
    try {
      setError('');
      setLoading(true);
      await signInWithGoogle();
      navigate('/');
    } catch (error) {
      setError('Failed to sign up with Google: ' + error.message);
    }
    setLoading(false);
  };

  const handleAppleSignUp = async () => {
    try {
      setError('');
      setLoading(true);
      await signInWithApple();
      navigate('/');
    } catch (error) {
      setError('Failed to sign up with Apple: ' + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="signup-container" style={{ backgroundImage: `url(${signupBg})` }}>
      <div className="signup-overlay">
        <div className={`content-wrapper ${moveToPosition ? 'positioned' : 'centered'}`}>
        <div className={`left-section ${showCard ? 'show-card' : ''}`}>
          <div className="signup-card">
            <h2 className="card-title">Create an Account</h2>
            
            {error && <div className="error-message">{error}</div>}
            
            <form className="signup-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input 
                  type="text" 
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="form-input"
                  required
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Email</label>
                <input 
                  type="email" 
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="form-input"
                  required
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Password</label>
                <div className="password-wrapper">
                  <input 
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="****************"
                    required
                  />
                  <button 
                    type="button" 
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M10 4C4.5 4 2 10 2 10s2.5 6 8 6 8-6 8-6-2.5-6-8-6z" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </button>
                </div>
              </div>
              
              <button type="submit" className="get-started-btn" disabled={loading}>
                {loading ? 'CREATING ACCOUNT...' : 'GET STARTED'}
              </button>
            </form>

            <div className="divider">
              <span>Or</span>
            </div>

            <div className="social-buttons">
              <button 
                type="button"
                onClick={handleGoogleSignUp} 
                className="social-btn" 
                disabled={loading}
              >
                <img src={googleLogo} alt="Google" className="social-icon" />
                Sign up with Google
              </button>
              
              <button 
                type="button"
                onClick={handleAppleSignUp} 
                className="social-btn" 
                disabled={loading}
              >
                <img src={appleLogo} alt="Apple" className="social-icon" />
                Sign up with Apple
              </button>
            </div>

            <div className="signin-link">
              Own an Account? <button onClick={() => navigate('/signin')} className="signin-btn">SignIn</button>
            </div>
          </div>
        </div>

        <div className="right-section">
          <div className={`logo-container ${showLogo ? 'fade-in' : ''}`}>
            <img src={logo} alt="Engage Track Logo" className="logo" />
          </div>
          <div className={`tagline-container ${showText ? 'fade-in' : ''}`}>
            <h1 className="main-heading">Illuminate learning with<br />AI-powered attention tracking</h1>
            <p className="sub-text">helping educators tailor instruction, intervene promptly, and foster more effective, personalized learning experiences.</p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default SignUp;